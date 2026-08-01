import * as XLSX from 'xlsx'
import type { PipelineJob, SubmitJobBody } from '@/utils/ingestionV2Api'

// ── Excel template ────────────────────────────────────────────────────────────
// Bulk uploads must use this exact shape. Complexity is NOT a column — bulk items are
// always 'complex' (see BULK_COMPLEXITY); S.No is a human reference and is ignored.
export const TEMPLATE_HEADERS = ['S.No', 'gender', 'category', 'sub-category', 'url'] as const

export const BULK_COMPLEXITY = 'complex'
export const BULK_VTON_MODEL = 'gemini_nano_banana'

const CATEGORIES = ['topwear', 'bottomwear', 'dress'] as const
const GENDERS = ['female', 'male', 'unisex'] as const

export type BulkRow = {
  rowNumber: number          // 1-based sheet row (for error messages)
  product_url: string
  product_gender_type: SubmitJobBody['product_gender_type']
  product_type: SubmitJobBody['product_type']
  product_sub_type: string
}

export type ParseResult = {
  rows: BulkRow[]
  errors: string[]
}

export function downloadTemplate(): void {
  const rows = [
    TEMPLATE_HEADERS,
    [1, 'female', 'topwear', 'Short kurtas & kurtis', 'https://example.com/product-page'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 60 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'items')
  XLSX.writeFile(wb, 'atlyr-bulk-ingestion-template.xlsx')
}

const norm = (v: unknown) => String(v ?? '').trim()

/**
 * Parse an uploaded workbook against the template. Rows are validated individually so a
 * single bad row reports its own line rather than failing the whole file; only valid rows
 * are returned for submission.
 */
export function parseWorkbook(data: ArrayBuffer): ParseResult {
  const wb = XLSX.read(data, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { rows: [], errors: ['The workbook has no sheets.'] }

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' })
  if (!raw.length) return { rows: [], errors: ['No data rows found — use the downloaded template.'] }

  // Header lookup is case/space-insensitive so "Sub-Category" and "sub-category" both work.
  const keyFor = (obj: Record<string, unknown>, want: string) => {
    const target = want.toLowerCase().replace(/[\s_-]/g, '')
    return Object.keys(obj).find(k => k.toLowerCase().replace(/[\s_-]/g, '') === target)
  }

  const first = raw[0]
  const missing = ['gender', 'category', 'sub-category', 'url'].filter(h => !keyFor(first, h))
  if (missing.length) {
    return { rows: [], errors: [`Missing column(s): ${missing.join(', ')}. Download the template and use it as-is.`] }
  }

  const rows: BulkRow[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  raw.forEach((r, i) => {
    const rowNumber = i + 2                       // +1 header, +1 to 1-base
    const url = norm(r[keyFor(r, 'url')!])
    const gender = norm(r[keyFor(r, 'gender')!]).toLowerCase()
    const category = norm(r[keyFor(r, 'category')!]).toLowerCase()
    const sub = norm(r[keyFor(r, 'sub-category')!])

    if (!url && !gender && !category && !sub) return    // skip blank spacer rows

    if (!/^https?:\/\//i.test(url)) { errors.push(`Row ${rowNumber}: url must start with http(s)://`); return }
    if (seen.has(url)) { errors.push(`Row ${rowNumber}: duplicate url in this sheet — skipped`); return }
    if (category && !CATEGORIES.includes(category as typeof CATEGORIES[number])) {
      errors.push(`Row ${rowNumber}: category must be ${CATEGORIES.join(' / ')}`); return
    }
    if (!category) { errors.push(`Row ${rowNumber}: category is required`); return }
    if (!sub) { errors.push(`Row ${rowNumber}: sub-category is required`); return }
    if (gender && !GENDERS.includes(gender as typeof GENDERS[number])) {
      errors.push(`Row ${rowNumber}: gender must be ${GENDERS.join(' / ')}`); return
    }

    seen.add(url)
    rows.push({
      rowNumber,
      product_url: url,
      product_gender_type: (gender || 'female') as SubmitJobBody['product_gender_type'],
      product_type: category as SubmitJobBody['product_type'],
      product_sub_type: sub,
    })
  })

  return { rows, errors }
}

// ── Batch identity ────────────────────────────────────────────────────────────
// A bulk run is grouped by the uploaded file name, stored on each job's created_by.
// Prefixed so bulk batches are distinguishable from manual/CLI submissions.
export const BATCH_PREFIX = 'bulk:'
export const batchIdFor = (fileName: string) => `${BATCH_PREFIX}${fileName.replace(/\.xlsx?$/i, '')}`
export const isBulkJob = (j: PipelineJob) => (j.created_by ?? '').startsWith(BATCH_PREFIX)
export const batchLabel = (createdBy: string) => createdBy.slice(BATCH_PREFIX.length)

// ── Progress ──────────────────────────────────────────────────────────────────
export const TERMINAL_DONE = ['completed'] as const
export const HITL_STATES = ['awaiting_hitl_identification', 'awaiting_hitl_segmentation'] as const
export const FAILED_STATES = ['failed', 'discarded', 'cancelled'] as const

export type BatchProgress = {
  id: string
  label: string
  total: number
  completed: number
  hitl: number
  failed: number
  running: number
  /** completed + hitl (reviewable) as a share of total — HITL items are "work done". */
  percent: number
  lastActivity: string
  jobs: PipelineJob[]
}

export function summarizeBatches(jobs: PipelineJob[]): BatchProgress[] {
  const groups = new Map<string, PipelineJob[]>()
  for (const j of jobs) {
    if (!isBulkJob(j)) continue
    const id = j.created_by as string
    const list = groups.get(id) ?? []
    list.push(j)
    groups.set(id, list)
  }

  return [...groups.entries()].map(([id, list]) => {
    const completed = list.filter(j => TERMINAL_DONE.includes(j.current_state as never)).length
    const hitl = list.filter(j => HITL_STATES.includes(j.current_state as never)).length
    const failed = list.filter(j => FAILED_STATES.includes(j.current_state as never)).length
    const total = list.length
    const lastActivity = list.reduce((a, j) => (j.updated_at > a ? j.updated_at : a), list[0]?.updated_at ?? '')
    return {
      id,
      label: batchLabel(id),
      total,
      completed,
      hitl,
      failed,
      running: total - completed - hitl - failed,
      percent: total ? Math.round(((completed + hitl) / total) * 100) : 0,
      lastActivity,
      jobs: list,
    }
  }).sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1))
}

// ── Cost estimate ─────────────────────────────────────────────────────────────
// The pipeline records which model ran (artifact `model_used`) but NOT token usage, so an
// exact bill cannot be derived from the DB. These are per-operation list-price estimates —
// edit the rates here if pricing changes. Everything shown in the UI is labelled "estimate".
export const COST_RATES = {
  /** Gemini text — garment summary + enrichment = 2 calls per attempt, ~$0.0006 each. */
  geminiTextPerCall: 0.0006,
  geminiTextCallsPerAttempt: 2,
  /** Gemini image (VTON) — one 2K image per attempt. */
  geminiVtonPerImage: 0.134,
  /** Modal GPU — segmentation + placement runs, averaged per successful pass. */
  modalSegmentationPerRun: 0.012,
  modalPlacementPerRun: 0.004,

  // ── Per-unit rates used when a job recorded real usage (exact mode) ──────────
  /** USD per 1M tokens, Gemini text (input / output). */
  textInputPerMTok: 0.30,
  textOutputPerMTok: 2.50,
  /** USD per 1M tokens, Gemini image output (a 2K image bills ~2k tokens). */
  imageOutputPerMTok: 30.0,
  imageInputPerMTok: 0.30,
  /** USD per GPU-second on Modal (A10G-class). */
  modalPerGpuSecond: 0.000306,
}

/** Usage recorded on an artifact by the pipeline (absent on jobs run before cost tracking). */
export type ArtifactUsage = { prompt_tokens?: number; output_tokens?: number; total_tokens?: number }

export type ArtifactRow = {
  job_id: string
  artifact_type: string
  data: Record<string, unknown> | null
}

/**
 * Exact cost from recorded usage. Returns null when no artifact in the batch carries usage
 * data — i.e. everything predates cost tracking — so the caller can fall back to the estimate.
 * Jobs that partially recorded (older retries) still contribute what they have.
 */
export function actualCost(rows: ArtifactRow[]): (CostBreakdown & { isEstimate: false }) | null {
  let geminiText = 0, geminiVton = 0, modal = 0
  let vtonRuns = 0, modalRuns = 0, withUsage = 0

  const price = (u: ArtifactUsage, inRate: number, outRate: number) => {
    const inTok = u.prompt_tokens ?? 0
    const outTok = u.output_tokens ?? Math.max((u.total_tokens ?? 0) - inTok, 0)
    return (inTok / 1e6) * inRate + (outTok / 1e6) * outRate
  }

  for (const r of rows) {
    const d = r.data ?? {}
    const usage = d.usage as ArtifactUsage | null | undefined
    const durationMs = typeof d.duration_ms === 'number' ? d.duration_ms : null

    if (r.artifact_type === 'garment_summary' || r.artifact_type === 'enrichment') {
      if (usage) { geminiText += price(usage, COST_RATES.textInputPerMTok, COST_RATES.textOutputPerMTok); withUsage++ }
    } else if (r.artifact_type === 'vton_image') {
      if (usage) {
        geminiVton += price(usage, COST_RATES.imageInputPerMTok, COST_RATES.imageOutputPerMTok)
        vtonRuns++; withUsage++
      }
    } else if (r.artifact_type === 'segmentation' || r.artifact_type === 'placement') {
      if (durationMs !== null) {
        modal += (durationMs / 1000) * COST_RATES.modalPerGpuSecond
        modalRuns++; withUsage++
      }
    }
  }

  if (!withUsage) return null
  return {
    geminiText, geminiVton, modal,
    total: geminiText + geminiVton + modal,
    attempts: 0, vtonRuns, modalRuns,
    isEstimate: false,
  }
}

export type CostBreakdown = {
  geminiText: number
  geminiVton: number
  modal: number
  total: number
  attempts: number        // total attempts incl. retries
  vtonRuns: number
  modalRuns: number
  isEstimate: boolean
}

/**
 * Estimate spend for a batch, counting retries. `error_count` is the number of failed
 * attempts a job has accumulated, so attempts = error_count + 1; a job that never reached a
 * step isn't charged for it (we key off how far its state got).
 */
export function estimateCost(jobs: PipelineJob[]): CostBreakdown {
  const ORDER = [
    'pending', 'scraping', 'identifying', 'generating_garment_summary', 'generating_vton',
    'segmenting', 'segmented', 'awaiting_hitl_segmentation', 'placement', 'completed',
  ]
  const reached = (j: PipelineJob, step: string) => {
    // A failed job reached the step it died at; otherwise use its current state.
    const at = j.current_state === 'failed' ? (j.last_error_step ?? 'pending') : j.current_state
    return ORDER.indexOf(at) >= ORDER.indexOf(step)
  }

  let attempts = 0, textCalls = 0, vtonRuns = 0, segRuns = 0, placeRuns = 0
  for (const j of jobs) {
    const tries = (j.error_count ?? 0) + 1
    attempts += tries
    if (reached(j, 'generating_garment_summary')) textCalls += COST_RATES.geminiTextCallsPerAttempt * tries
    if (reached(j, 'generating_vton')) vtonRuns += tries
    if (reached(j, 'segmenting')) segRuns += tries
    if (reached(j, 'placement')) placeRuns += tries
  }

  const geminiText = textCalls * COST_RATES.geminiTextPerCall
  const geminiVton = vtonRuns * COST_RATES.geminiVtonPerImage
  const modal = segRuns * COST_RATES.modalSegmentationPerRun + placeRuns * COST_RATES.modalPlacementPerRun
  return {
    geminiText, geminiVton, modal,
    total: geminiText + geminiVton + modal,
    attempts, vtonRuns, modalRuns: segRuns + placeRuns,
    isEstimate: true as const,
  }
}

export const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`
