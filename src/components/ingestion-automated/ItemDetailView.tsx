import { ArrowLeft, ExternalLink, RefreshCcw, Trash2, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { PipelineJob } from '@/utils/ingestionV2Api'
import type { ProductMeta } from './useProductMeta'
import type { GarmentSummaryData } from './useGarmentSummary'
import { STATE_LABELS } from '@/components/ingestion-v2/constants'
import { rowStateOf, type Stage, type RowState } from './stateMapping'

// Presentational, props-driven recreation of the design prototype's full-page Item Detail
// view (Atlyr Prototype.dc.html:264-348). It does NO data fetching — all data and actions
// arrive via props so it can be driven by mock data in an isolated preview and by the real
// hooks in ItemDetailPage. Styling follows the prototype's warm palette (theme-aware: warm
// tones in light mode, neutral equivalents in dark).

export type DetailImageTile = { label: string; url: string | null; note?: string; badge?: string }

export type ItemDetailImages = {
  stage1Slots: DetailImageTile[]   // the 4 VTON slots (Front·Mod, Front·Flt, Back·Mod, Back·Flt)
  submittedCount: number           // how many raw images were scraped
  gen: string | null               // Stage 2 generated try-on
  segmented: string | null
  placed: string | null
}

// A single editable attribute — text input or a select.
export type EditableField =
  | { kind: 'text'; key: string; label: string; value: string; mono?: boolean; type?: 'text' | 'number' }
  | { kind: 'select'; key: string; label: string; value: string; options: { value: string; label: string }[] }

type Props = {
  job: PipelineJob
  stage: Stage
  name: string
  meta: string
  productMeta: ProductMeta | undefined
  garmentSummary: GarmentSummaryData | undefined
  images: ItemDetailImages
  editableFields: EditableField[]
  summary: string | null
  scrapedMeta: Record<string, unknown> | null
  canProceed: boolean
  onClose: () => void
  onRescrape: () => void
  onRedo: () => void         // re-run VTON generation (from generating_vton)
  onResegment: () => void    // re-run segmentation
  onReplace: () => void      // re-run placement (Modal pipeline)
  onDelete: () => void
  onProceed: () => void
  // Called when an editable attribute loses focus with a changed value.
  onSaveField: (key: string, value: string) => void
  busy?: string | null
}

// Prototype palette (Atlyr Prototype.dc.html) mapped to theme-aware light/dark pairs.
const PAGE = 'bg-[#FAFAF8] dark:bg-neutral-950'
const HEADER = 'flex flex-none items-center gap-3 border-b border-[#E6E4E0] dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-3'
const CARD = 'rounded-lg border border-[#E6E4E0] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex flex-col gap-2.5'
const SECTION_LABEL = 'text-[10px] font-semibold uppercase tracking-wide text-[#8A857C] dark:text-neutral-400'
const LOG_BLOCK = 'rounded-md border border-[#EDEBE7] dark:border-neutral-800 bg-[#FAFAF8] dark:bg-neutral-900/60 p-2.5 font-mono text-[10.5px] leading-relaxed text-[#57534E] dark:text-neutral-400 whitespace-pre-wrap'
const BODY = 'text-[#26221E] dark:text-neutral-100'
const MUTED = 'text-[#8A857C] dark:text-neutral-400'
// Prototype's dark primary button (charcoal) / light-inverted in dark mode.
const DARK_BTN = 'bg-[#26221E] text-white hover:bg-[#26221E]/90 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200'

// Status-pill palette (prototype pillPal) → light/dark pairs.
const PILL_TONE: Record<RowState, string> = {
  ready:      'bg-[#EAF4EE] text-[#1E6B44] dark:bg-emerald-950/50 dark:text-emerald-300',
  processing: 'bg-[#F4F2EF] text-[#57534E] dark:bg-neutral-800 dark:text-neutral-300',
  attention:  'bg-[#FBF3E4] text-[#8A5A12] dark:bg-amber-950/50 dark:text-amber-300',
  error:      'bg-[#FBEFED] text-[#9C3B30] dark:bg-red-950/50 dark:text-red-300',
}
const PILL_ICON: Record<RowState, string> = { ready: '✓', processing: '◌', attention: '⚑', error: '✕' }

export function ItemDetailView({
  job, stage, name, meta, productMeta, garmentSummary, images, editableFields, summary,
  scrapedMeta, canProceed, onClose, onRescrape, onRedo, onResegment, onReplace, onDelete, onProceed, onSaveField, busy,
}: Props) {
  const stateLabel = STATE_LABELS[job.current_state] ?? job.current_state
  const rowState = rowStateOf(job)
  const stage2Started = stage === 2

  // Stage 1 log — composed from real fields (mirrors the prototype's dtS1Log).
  const slotsFilled = images.stage1Slots.filter(s => s.url).length
  const sourceHost = safeHost(job.product_url)
  const s1Log = [
    `added by ${job.created_by ?? 'unknown'} · ${new Date(job.created_at).toLocaleString()}`,
    `crawl · ${sourceHost}`,
    `extract · ${slotsFilled}/${images.stage1Slots.length} photo slots filled`,
    ...(job.last_error && stage === 1 ? [`✕ ${job.last_error}`] : []),
  ].join('\n')

  // Activity timeline — composed from real fields (mirrors the prototype's dtActivity).
  const activity = [
    `${new Date(job.created_at).toLocaleString()} · created by ${job.created_by ?? 'unknown'}`,
    ...(stage === 2 ? [`pushed to Stage 2 · generation`] : []),
    ...(job.error_count > 0 ? [`✕ ${job.error_count} error(s)${job.last_error_step ? ` at ${job.last_error_step}` : ''}`] : []),
    ...(job.current_state === 'completed' ? ['✓ completed'] : []),
    `now · state = ${job.current_state}`,
  ].join('\n')

  return (
    <div className={cn('fixed inset-0 z-40 flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-150', PAGE, BODY)}>
      {/* Header */}
      <div className={HEADER}>
        <button onClick={onClose} className={cn('flex items-center gap-1 rounded-md border border-[#E6E4E0] dark:border-neutral-700 px-2.5 py-1.5 text-xs font-semibold shrink-0 hover:text-[#26221E] dark:hover:text-white', MUTED)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Queue
        </button>
        <span className={cn('text-sm font-bold truncate max-w-[40%]', BODY)}>{name}</span>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold', PILL_TONE[rowState])}>
          {PILL_ICON[rowState]} {stateLabel}
        </span>
        <span className={cn('text-[11.5px] truncate hidden md:inline', MUTED)}>{meta}</span>
        <a href={job.product_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[11.5px] font-semibold text-[#2a78d6] dark:text-sky-400 underline-offset-2 hover:underline shrink-0">
          <ExternalLink className="h-3 w-3" /> Source
        </a>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {stage === 1 ? (
            <Button size="sm" variant="outline" className="h-7 text-xs border-[#DCD9D3] text-[#57534E] dark:border-neutral-700 dark:text-neutral-300" disabled={busy !== null} onClick={onRescrape}>
              <RefreshCcw className="h-3 w-3 mr-1" /> Re-scrape
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs border-[#DCD9D3] text-[#57534E] dark:border-neutral-700 dark:text-neutral-300" disabled={busy !== null} onClick={onRedo}>
              <RefreshCcw className="h-3 w-3 mr-1" /> Redo
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs border-[#C4564A]/60 text-[#9C3B30] hover:text-[#9C3B30] dark:border-red-900 dark:text-red-300" disabled={busy !== null} onClick={onDelete}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      </div>

      {/* Body — two independent columns so cards pack top-to-bottom (no stretched gaps):
          left = attributes + Stage 2, right = Stage 1 + Pack JSON + Activity. */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Error banner — full width — surfaces the last failure (e.g. a VTON timeout) */}
        {job.current_state === 'failed' && job.last_error && (
          <div className="mb-4 flex flex-col gap-1 rounded-lg border border-[#F2DAD5] bg-[#FBEFED] p-3 dark:border-red-900 dark:bg-red-950/40">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#9C3B30] dark:text-red-300">
              <span>✕</span> Failed at {job.last_error_step ?? job.current_state} · {job.error_count} attempt{job.error_count === 1 ? '' : 's'}
            </div>
            <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#9C3B30]/90 dark:text-red-300/90">{job.last_error}</p>
          </div>
        )}

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* Left column */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/* Item attributes */}
            <div className={CARD}>
              <div className={SECTION_LABEL}>
                Item attributes <span className={cn('ml-1 font-normal normal-case tracking-normal', MUTED)}>— auto-saves on blur</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                {editableFields.map(field => (
                  <FieldControl key={field.key} field={field} onSaveField={onSaveField} />
                ))}
              </div>

              {/* Read-only tech-pack attributes (no PATCH endpoint) */}
              {garmentSummary && garmentSummary.techPack.length > 0 && (
                <div className="mt-1 border-t border-[#E6E4E0] dark:border-neutral-800 pt-2.5">
                  <div className={cn('mb-1.5 text-[10px] font-semibold uppercase tracking-wide', MUTED)}>From garment summary (read-only)</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    {garmentSummary.techPack.map(entry => (
                      <div key={entry.key} className="truncate">
                        <span className={cn('capitalize', MUTED)}>{entry.label.toLowerCase()} </span>
                        <span className={cn('font-medium', BODY)}>{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className={cn('mb-1 text-[10.5px]', MUTED)}>Summary</div>
                <p className={cn('min-h-[40px] rounded-md bg-[#F4F2EF] dark:bg-neutral-800 p-2 text-[11.5px] leading-relaxed', BODY)}>
                  {summary || <span className={cn('italic', MUTED)}>No summary yet</span>}
                </p>
              </div>
            </div>

            {/* Stage 2 — Generation */}
            <div className={CARD}>
              <div className="flex items-center justify-between">
                <div className={SECTION_LABEL}>Stage 2 — Generation</div>
                <span className={cn('text-[11px] font-semibold', MUTED)}>
                  {stage2Started ? stateLabel : 'not started'}
                </span>
              </div>
              {stage2Started ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <ImageTile tile={{ label: 'Gen', url: images.gen, note: images.gen ? undefined : 'Queued' }} />
                    <ImageTile tile={{ label: 'Sgmtd', url: images.segmented, note: images.segmented ? undefined : 'Waiting' }} />
                    <ImageTile tile={{ label: 'Placed', url: images.placed, note: images.placed ? undefined : 'Waiting' }} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 flex-1 text-xs border-[#DCD9D3] text-[#57534E] dark:border-neutral-700 dark:text-neutral-300" disabled={busy !== null} onClick={onRedo}>
                      <RefreshCcw className="h-3 w-3 mr-1" /> VTon
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 flex-1 text-xs border-[#DCD9D3] text-[#57534E] dark:border-neutral-700 dark:text-neutral-300" disabled={busy !== null} onClick={onResegment}>
                      <RefreshCcw className="h-3 w-3 mr-1" /> Segment
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 flex-1 text-xs border-[#DCD9D3] text-[#57534E] dark:border-neutral-700 dark:text-neutral-300" disabled={busy !== null || !images.segmented} onClick={onReplace}>
                      <RefreshCcw className="h-3 w-3 mr-1" /> Place
                    </Button>
                    {canProceed && (
                      <Button size="sm" className={cn('h-7 flex-1 text-xs', DARK_BTN)} disabled={busy !== null} onClick={onProceed}>
                        <ArrowUpRight className="h-3 w-3 mr-1" /> Push
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[#DCD9D3] dark:border-neutral-700 bg-[#FAFAF8] dark:bg-neutral-900/60 px-4 py-6">
                  <p className={cn('text-xs', MUTED)}>Stage 2 has not started for this item.</p>
                  <Button size="sm" className={cn('h-7 text-xs', DARK_BTN)} disabled={busy !== null || !canProceed} onClick={onProceed}>
                    Push to Stage 2 →
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/* Stage 1 — Scrape & tag */}
            <div className={CARD}>
              <div className="flex items-center justify-between">
                <div className={SECTION_LABEL}>Stage 1 — Scrape &amp; tag</div>
                <span className={cn('text-[11px] font-semibold', MUTED)}>
                  {stage === 1 ? stateLabel : '✓ complete'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {images.stage1Slots.map(tile => <ImageTile key={tile.label} tile={tile} />)}
              </div>
              <div className={LOG_BLOCK}>{s1Log}</div>
            </div>

            {/* Scraped metadata — the raw crawl_meta the scraper captured */}
            {scrapedMeta && (
              <div className={CARD}>
                <div className={SECTION_LABEL}>Scraped metadata</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  {Object.entries(scrapedMeta)
                    .filter(([k, v]) => v != null && v !== '' && typeof v !== 'object' && k !== 'description' && k !== 'final_url')
                    .map(([k, v]) => (
                      <div key={k} className="truncate">
                        <span className={cn('capitalize', MUTED)}>{k.replace(/_/g, ' ')} </span>
                        <span className={cn('font-medium', BODY)}>{String(v)}</span>
                      </div>
                    ))}
                </div>
                {typeof scrapedMeta.final_url === 'string' && (
                  <a href={scrapedMeta.final_url} target="_blank" rel="noopener noreferrer" className="truncate text-[11px] font-medium text-[#2a78d6] hover:underline dark:text-sky-400">
                    ↗ {scrapedMeta.final_url}
                  </a>
                )}
                {typeof scrapedMeta.description === 'string' && scrapedMeta.description && (
                  <div>
                    <div className={cn('mb-1 text-[10.5px]', MUTED)}>Description</div>
                    <pre className={cn('max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[#F4F2EF] p-2 font-sans text-[11px] leading-relaxed dark:bg-neutral-800', BODY)}>{scrapedMeta.description}</pre>
                  </div>
                )}
              </div>
            )}

            {/* Activity */}
            <div className={CARD}>
              <div className={SECTION_LABEL}>Activity</div>
              <div className={LOG_BLOCK}>{activity}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FieldControl({ field, onSaveField }: { field: EditableField; onSaveField: (key: string, value: string) => void }) {
  return (
    <div className="min-w-0">
      <div className={cn('mb-1 text-[10.5px]', MUTED)}>{field.label}</div>
      {field.kind === 'select' ? (
        <Select value={field.value} onValueChange={v => onSaveField(field.key, v)}>
          <SelectTrigger className={cn('h-7 w-full min-w-0 border-transparent bg-[#F4F2EF] dark:bg-neutral-800 px-2 text-xs [&>svg]:h-3 [&>svg]:w-3', BODY)}><SelectValue /></SelectTrigger>
          <SelectContent>
            {field.options.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <input
          type={field.type ?? 'text'}
          defaultValue={field.value}
          onBlur={e => { if (e.target.value !== field.value) onSaveField(field.key, e.target.value) }}
          placeholder="—"
          className={cn(
            'h-7 w-full min-w-0 truncate rounded-md border border-transparent bg-[#F4F2EF] dark:bg-neutral-800 px-2 text-xs font-medium focus:border-[#26221E] dark:focus:border-neutral-400 focus:bg-white dark:focus:bg-neutral-900 focus:outline-none',
            BODY,
            field.mono && 'font-mono',
          )}
        />
      )}
    </div>
  )
}

function ImageTile({ tile }: { tile: DetailImageTile }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-[#E6E4E0] dark:border-neutral-800 bg-[#F4F2EF] dark:bg-neutral-800">
        {tile.url ? (
          <img src={tile.url} alt={tile.label} className="h-full w-full object-contain" />
        ) : (
          <span className="px-1 text-center text-[9px] text-[#8A857C] dark:text-neutral-400">{tile.note ?? 'Not yet'}</span>
        )}
        {tile.badge && (
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[8px] text-white">{tile.badge}</span>
        )}
      </div>
      <span className={cn('truncate text-[10px] font-medium', BODY)}>{tile.label}</span>
    </div>
  )
}

function safeHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
