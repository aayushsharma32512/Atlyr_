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
    [...TEMPLATE_HEADERS],
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
/** Economy-lane rows sitting in a batch tray at Google — running, but not by us. */
export const BATCH_QUEUED_STATES = ['vton_batch_queued'] as const

export type BatchProgress = {
  id: string
  label: string
  total: number
  completed: number
  hitl: number
  failed: number
  running: number
  /**
   * Subset of `running` that is parked in a batch tray. Counted separately so a sheet submitted
   * in economy mode reads as "queued at Google" rather than as frozen — the rows genuinely will
   * not move for minutes-to-hours, and a progress bar that just sits there invites someone to
   * restart perfectly healthy work that has already been paid for.
   */
  batchQueued: number
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
    const batchQueued = list.filter(j => BATCH_QUEUED_STATES.includes(j.current_state as never)).length
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
      batchQueued,
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
  /**
   * Economy lane multiplier. Google prices batch at 50% of the interactive rate, and
   * gemini-3-pro-image bills 1K and 2K identically, so this holds at our output size.
   * Note the *realised* saving is nearer 40%: refused items re-run at full instant price.
   */
  batchDiscount: 0.5,
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
  /**
   * USD per container-second on Modal, verified against modal.com/pricing 2026-08-22.
   *
   *   L4 GPU        $0.000222  / sec   (both apps run gpu="L4")
   *   CPU 4 cores   $0.0000524 / sec   ($0.0000131/core/sec, and both apps set cpu=4.0)
   *   ────────────────────────────
   *                 $0.0002744 / sec
   *
   * Two corrections rolled in here: the old 0.000306 was the A10 rate (wrong hardware), and CPU
   * was omitted entirely even though Modal bills it separately from GPU — a ~24% undercount.
   * Memory is billed too ($0.00000222/GiB/sec) but is small and not pinned to a known allocation.
   *
   * Caveat this rate cannot fix: the `duration_ms` it multiplies is HTTP wall-clock from the Node
   * handler, so container scheduling and cold start are billed here as compute. Separately, the
   * idle `scaledown_window` tail after each container's last job is real spend that never appears
   * in any job's duration, so it is invisible to this accounting entirely.
   */
  modalPerGpuSecond: 0.0002744,
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
const priceUsage = (u: ArtifactUsage, inRate: number, outRate: number) => {
  const inTok = u.prompt_tokens ?? 0
  const outTok = u.output_tokens ?? Math.max((u.total_tokens ?? 0) - inTok, 0)
  return (inTok / 1e6) * inRate + (outTok / 1e6) * outRate
}

export function actualCost(rows: ArtifactRow[]): (CostBreakdown & { isEstimate: false }) | null {
  let geminiText = 0, geminiVton = 0, modal = 0
  let vtonRuns = 0, modalRuns = 0, withUsage = 0

  const price = priceUsage

  for (const r of rows) {
    const d = r.data ?? {}
    const usage = d.usage as ArtifactUsage | null | undefined
    const durationMs = typeof d.duration_ms === 'number' ? d.duration_ms : null

    if (r.artifact_type === 'garment_summary' || r.artifact_type === 'enrichment') {
      if (usage) { geminiText += price(usage, COST_RATES.textInputPerMTok, COST_RATES.textOutputPerMTok); withUsage++ }
    } else if (r.artifact_type === 'vton_image') {
      // Economy-lane images cost half. Pricing them at the interactive rate would report the
      // batch lane as costing exactly what it was turned on to avoid.
      const route = typeof d.route_used === 'string' ? d.route_used : ''
      const rate = route.startsWith('batch:') ? COST_RATES.batchDiscount : 1

      if (usage) {
        geminiVton += rate * price(usage, COST_RATES.imageInputPerMTok, COST_RATES.imageOutputPerMTok)
        vtonRuns++; withUsage++
      } else {
        // No usage recorded. Fall back to the flat per-image rate rather than silently pricing
        // this image at zero — an image that exists was paid for. Deliberately does NOT count
        // toward `withUsage`: the "actual" label still has to be earned by real measurements.
        geminiVton += rate * COST_RATES.geminiVtonPerImage
        vtonRuns++
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

// ── Route breakdown ───────────────────────────────────────────────────────────
// Since the multi-route transport (Fix 2), Gemini-backed artifacts carry `route_used` (which
// quota pool served the call) and `attempted` (failed route/model attempts before the one that
// succeeded). Rolled up per batch so the dialog can show where the money went and what the
// failover machinery absorbed. Artifacts from before Fix 2 have neither field and are skipped.

export type RouteRow = { route: string; calls: number; images: number; cost: number }

/** Human label for a route id: 'vertex:global' → 'Vertex · global', 'ai_studio' → 'AI Studio'. */
export const routeLabel = (route: string) =>
  route === 'ai_studio' ? 'AI Studio' : route.startsWith('vertex:') ? `Vertex · ${route.slice(7)}` : route

export function routeSummary(rows: ArtifactRow[]): { routes: RouteRow[]; failover: Record<string, number> } {
  const routes = new Map<string, RouteRow>()
  const failover: Record<string, number> = {}

  for (const r of rows) {
    if (!['garment_summary', 'enrichment', 'vton_image'].includes(r.artifact_type)) continue
    const d = r.data ?? {}

    const route = typeof d.route_used === 'string' ? d.route_used : null
    if (route) {
      const isImage = r.artifact_type === 'vton_image'
      const usage = d.usage as ArtifactUsage | null | undefined
      const cost = usage
        ? priceUsage(
            usage,
            isImage ? COST_RATES.imageInputPerMTok : COST_RATES.textInputPerMTok,
            isImage ? COST_RATES.imageOutputPerMTok : COST_RATES.textOutputPerMTok,
          )
        : 0
      const row = routes.get(route) ?? { route, calls: 0, images: 0, cost: 0 }
      row.calls += 1
      if (isImage) row.images += 1
      row.cost += cost
      routes.set(route, row)
    }

    const attempted = d.attempted as { errorKind?: string }[] | null | undefined
    if (Array.isArray(attempted)) {
      for (const a of attempted) {
        const kind = a?.errorKind ?? 'unknown'
        failover[kind] = (failover[kind] ?? 0) + 1
      }
    }
  }

  return { routes: [...routes.values()].sort((a, b) => b.calls - a.calls), failover }
}
