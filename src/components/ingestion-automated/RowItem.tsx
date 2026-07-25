import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  ExternalLink, Info, RefreshCcw, ArrowUpRight, Trash2, ChevronLeft, ChevronRight, Loader2,
  ChevronDown, ChevronUp, Eraser,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { v2Api, type PipelineJob, type UpdateJobDetailsBody } from '@/utils/ingestionV2Api'
import { STATE_LABELS } from '@/components/ingestion-v2/constants'
import { rowStateOf, isPushed, canProceed, attentionNote, type RowState, type Stage } from './stateMapping'
import { PhotoCard } from './PhotoCard'
import type { ViewerImage } from './PhotoViewerDialog'
import { useNotWiredDialog } from './NotWiredDialog'
import type { ProductMeta } from './useProductMeta'
import type { ImageTag, View, PhotoType } from './useImageClassification'
import { EMPTY_SLOTS, type VtonSelection } from './useVtonSelection'
import type { GarmentSummaryData } from './useGarmentSummary'

const VIEW_OPTIONS: View[] = ['Front', 'Back', 'Side']
const TYPE_OPTIONS: PhotoType[] = ['Model', 'Flat', 'Detail']

// Side / Detail never fill a slot (see slotKeyFor in siglip.ts) — only Front/Back x
// Model/Flat combinations do.
const SLOT_KEY_FOR: Partial<Record<`${View}:${PhotoType}`, 'frontModel' | 'frontFlat' | 'backModel' | 'backFlat'>> = {
  'Front:Model': 'frontModel', 'Front:Flat': 'frontFlat',
  'Back:Model':  'backModel',  'Back:Flat':  'backFlat',
}

// Row + status-pill tones mirror the design handoff palette (RowItem.dc.html PAL / SB).
const ROW_TONE: Record<RowState, string> = {
  ready: 'border-emerald-600/50',
  processing: 'border-border',
  attention: 'border-amber-500/60 bg-amber-50/40 dark:bg-amber-950/10',
  error: 'border-destructive/50 bg-red-50/40 dark:bg-destructive/5',
}

const PILL_TONE: Record<RowState, string> = {
  ready: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300',
  processing: 'bg-muted border-border text-muted-foreground',
  attention: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300',
  error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300',
}

const FIELD_BOX = 'h-7 w-full min-w-0 rounded-md border border-transparent bg-muted px-2 text-xs font-medium text-foreground'
const FIELD_SELECT = 'h-7 w-full min-w-0 rounded-md border-transparent bg-muted px-2 text-xs font-medium focus:ring-1 focus:ring-offset-0 [&>svg]:h-3 [&>svg]:w-3'

const CATEGORY_OPTIONS = ['topwear', 'bottomwear', 'dress']
const GENDER_OPTIONS = ['female', 'male', 'unisex']
const COMPLEXITY_OPTIONS = ['simple', 'complex']
// Drives pickPreferredSlot server-side — 'auto' (null) defaults to 'model' priority.
const PREFERENCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto (Model)' },
  { value: 'model', label: 'Model' },
  { value: 'flat_lay', label: 'Flat Lay' },
]

// Keep the job's actual value selectable even when it isn't one of the standard enums.
const withCurrent = (std: string[], cur: string) => (!cur || std.includes(cur) ? std : [cur, ...std])

type Props = {
  job: PipelineJob
  stage: Stage
  tags: ImageTag[]
  selection: VtonSelection | undefined
  sourceImages: string[]
  product: ProductMeta | undefined
  refetchProduct: () => void
  garmentSummary: GarmentSummaryData | undefined
  selected: boolean
  onToggleSelect: (jobId: string) => void
  onOpenDetail: (jobId: string) => void
  onOpenError: (jobId: string) => void
  onOpenPlacement: (jobId: string) => void
  onOpenViewer: (images: ViewerImage[], index: number) => void
  onOpenEraser: (jobId: string) => void
  refetch: () => void
  refetchSelection: () => void
  refetchTags: () => void
}

export function RowItem({
  job, stage, tags, selection, sourceImages, product, refetchProduct, garmentSummary, selected, onToggleSelect, onOpenDetail, onOpenError, onOpenPlacement, onOpenViewer, onOpenEraser, refetch, refetchSelection, refetchTags,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [packOpen, setPackOpen] = useState(false)
  const [srcIdx, setSrcIdx] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [retagging, setRetagging] = useState(false)
  const [draftView, setDraftView] = useState<View>('Front')
  const [draftType, setDraftType] = useState<PhotoType>('Model')

  // Details form — Name/Brand/Price come from crawl_meta; the rest are real job columns.
  const [draftName, setDraftName] = useState(product?.name ?? '')
  const [draftBrand, setDraftBrand] = useState(product?.brand ?? '')
  const [draftPrice, setDraftPrice] = useState(product?.price != null ? String(product.price) : '')
  const [draftCategory, setDraftCategory] = useState(job.product_type)
  const [draftComplexity, setDraftComplexity] = useState(job.product_complexity)
  const [draftGender, setDraftGender] = useState(job.product_gender_type)
  const [draftSub, setDraftSub] = useState(job.product_sub_type ?? '')
  const [draftPreference, setDraftPreference] = useState(job.v_ton_image_preference?.type ?? 'auto')
  const [updatingDetails, setUpdatingDetails] = useState(false)

  const { toast } = useToast()
  const { notify, dialog } = useNotWiredDialog()

  // Re-sync drafts whenever the underlying data changes (initial load, or after a
  // successful Update Details refetch) — but not on every keystroke.
  useEffect(() => {
    setDraftName(product?.name ?? '')
    setDraftBrand(product?.brand ?? '')
    setDraftPrice(product?.price != null ? String(product.price) : '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.name, product?.brand, product?.price])

  useEffect(() => {
    setDraftCategory(job.product_type)
    setDraftComplexity(job.product_complexity)
    setDraftGender(job.product_gender_type)
    setDraftSub(job.product_sub_type ?? '')
    setDraftPreference(job.v_ton_image_preference?.type ?? 'auto')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.product_type, job.product_complexity, job.product_gender_type, job.product_sub_type, job.v_ton_image_preference?.type])

  const buildDetailsPatch = (): UpdateJobDetailsBody => {
    const patch: UpdateJobDetailsBody = {}
    if (draftName !== (product?.name ?? '')) patch.product_name = draftName
    if (draftBrand !== (product?.brand ?? '')) patch.brand = draftBrand
    const currentPriceStr = product?.price != null ? String(product.price) : ''
    if (draftPrice !== currentPriceStr) {
      const n = Number(draftPrice)
      if (draftPrice.trim() !== '' && !Number.isNaN(n)) patch.price = n
    }
    if (draftCategory !== job.product_type) patch.product_type = draftCategory as UpdateJobDetailsBody['product_type']
    if (draftComplexity !== job.product_complexity) patch.product_complexity = draftComplexity
    if (draftGender !== job.product_gender_type) patch.product_gender_type = draftGender as UpdateJobDetailsBody['product_gender_type']
    if (draftSub !== (job.product_sub_type ?? '')) patch.product_sub_type = draftSub
    const currentPreference = job.v_ton_image_preference?.type ?? 'auto'
    if (draftPreference !== currentPreference) {
      patch.v_ton_image_preference = draftPreference === 'auto' ? null : { type: draftPreference as 'model' | 'flat_lay' }
    }
    return patch
  }
  const detailsDirty = Object.keys(buildDetailsPatch()).length > 0

  const updateDetails = async () => {
    const patch = buildDetailsPatch()
    if (Object.keys(patch).length === 0) return
    setUpdatingDetails(true)
    try {
      await v2Api.updateJobDetails(job.job_id, patch)
      toast({ title: 'Details updated' })
      refetchProduct()
      refetch()
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setUpdatingDetails(false)
    }
  }

  const rowState = rowStateOf(job)
  const pushed = isPushed(job)
  const note = attentionNote(job)

  const runRestart = async (from: string, label: string) => {
    setBusy(label)
    try {
      await v2Api.restart(job.job_id, from)
      toast({ title: `Restarted from ${from}` })
      refetch()
    } catch (e) {
      toast({ title: 'Restart failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const runPush = async () => {
    setBusy('push')
    try {
      const res = await v2Api.proceed(job.job_id, {})
      toast({ title: 'Pushed', description: `→ ${res.current_state}` })
      refetch()
    } catch (e) {
      toast({ title: 'Push failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const pill = pushed
    ? { icon: '✓', text: 'Pushed', tone: PILL_TONE.ready, onClick: undefined as (() => void) | undefined }
    : rowState === 'error'
      ? { icon: '✕', text: job.last_error ?? 'Failed', tone: PILL_TONE.error, onClick: () => onOpenError(job.job_id) }
      : rowState === 'attention'
        ? {
            icon: '⚑', text: note ?? 'Needs review', tone: PILL_TONE.attention,
            onClick: () => job.current_state === 'placement' ? onOpenPlacement(job.job_id) : onOpenError(job.job_id),
          }
        : rowState === 'processing'
          ? { icon: '◌', text: `${STATE_LABELS[job.current_state] ?? job.current_state}…`, tone: PILL_TONE.processing, onClick: undefined }
          : { icon: '✓', text: 'Ready', tone: PILL_TONE.ready, onClick: undefined }

  const meta = [
    job.product_gender_type, job.product_type, job.product_sub_type || null,
    job.created_by, format(new Date(job.created_at), 'd MMM'),
  ].filter(Boolean).join(' · ')

  const vton = job.vton_image_url ?? job.v_ton_preferred_image

  // The 4 named slots the design calls for — resolved server-side (see
  // services/ingestion-automated/src/adapters/siglip.ts buildSlots/pickPreferredSlot),
  // including any manual retag overrides. Side / Macro Detail shots don't map to any of
  // these and are intentionally left out.
  const slots = selection?.slots ?? EMPTY_SLOTS
  const SLOT_DEFS = [
    { key: 'frontModel' as const, label: 'Front · Mod' },
    { key: 'frontFlat' as const, label: 'Front · Flt' },
    { key: 'backModel' as const, label: 'Back · Mod' },
    { key: 'backFlat' as const, label: 'Back · Flt' },
  ]
  const anySlotFilled = SLOT_DEFS.some(({ key }) => slots[key])
  const slotViewerImages: ViewerImage[] = SLOT_DEFS
    .filter(({ key }) => slots[key])
    .map(({ key, label }) => ({
      url: slots[key]!.url, label,
      note: slots[key]!.manual ? 'Manually tagged' : slots[key]!.uncertain ? 'Low confidence' : undefined,
    }))

  // Everything actually scraped, unfiltered — separate from the 4 classified winners
  // above (also the only place to see Side / Macro Detail shots).
  const srcIdxClamped = Math.min(srcIdx, Math.max(0, sourceImages.length - 1))
  const currentSrcUrl = sourceImages[srcIdxClamped]
  const currentTag = tags.find(t => t.url === currentSrcUrl)
  const srcViewerImages: ViewerImage[] = sourceImages.map((url, i) => ({ url, label: `Scraped ${i + 1}/${sourceImages.length}` }))

  // Which of the 4 slots this image's current tag would fill (if any), and whether it's
  // actually the one currently winning that slot.
  const currentBucketKey = currentTag?.view && currentTag.type !== 'Detail'
    ? SLOT_KEY_FOR[`${currentTag.view}:${currentTag.type}`]
    : undefined
  const isPrimary = !!currentBucketKey && slots[currentBucketKey]?.url === currentSrcUrl

  // Reset the retag draft to this image's effective tag whenever the carousel moves.
  useEffect(() => {
    setDraftView(currentTag?.view === 'Side' ? 'Front' : currentTag?.view ?? 'Front')
    setDraftType(currentTag?.type ?? 'Model')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSrcUrl])

  const applyTag = async (view: View, type: PhotoType) => {
    if (!currentSrcUrl) return
    setRetagging(true)
    try {
      const res = await v2Api.retagPhoto(job.job_id, {
        image_url: currentSrcUrl,
        type,
        ...(type !== 'Detail' && { view }),
      })
      toast({
        title: res.changed ? 'Photo retagged' : 'No change',
        description: res.changed
          ? (type === 'Detail' ? 'Detail' : `${view} · ${type}`)
          : 'Already the primary for this slot',
      })
      refetchSelection()
      refetchTags()
      refetch()
    } catch (e) {
      toast({ title: 'Retag failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setRetagging(false)
    }
  }

  return (
    <div
      className={cn(
        'flex items-stretch rounded-[10px] border-[1.5px] bg-card py-2.5 pl-1.5 pr-2.5 transition-opacity',
        ROW_TONE[rowState],
        pushed && 'opacity-60 border-border bg-muted/30'
      )}
    >
      {/* Left rail — delete pinned at the bottom, like the handoff */}
      <div className="flex w-8 shrink-0 flex-col items-center gap-2 pt-0.5">
        <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(job.job_id)} className="h-3.5 w-3.5" />
        <a href={job.product_url} target="_blank" rel="noopener noreferrer" title="Open source" className="text-muted-foreground hover:text-foreground">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button onClick={() => onOpenDetail(job.job_id)} title="Open detail" className="text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => runRestart(job.last_error_step ?? (stage === 1 ? 'scraping' : 'generating_vton'), 'rail-redo')}
          disabled={rowState === 'processing' || pushed || busy !== null}
          title="Restart"
          className="mt-auto text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <RefreshCcw className={cn('h-3.5 w-3.5', busy === 'rail-redo' && 'animate-spin')} />
        </button>
        <button
          onClick={() => canProceed(job) && runPush()}
          disabled={pushed || busy !== null || !canProceed(job)}
          title="Approve HITL / Push"
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => notify('Delete job')} title="Delete" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Fields panel */}
      <div className="flex min-w-0 basis-[38%] shrink-0 flex-col gap-1.5 border-l border-black/5 dark:border-white/5 px-3">
        {/* Meta line + expand toggle */}
        <div className="flex h-5 items-center gap-2 min-w-0">
          <span className="truncate text-[10.5px] text-muted-foreground">{meta}</span>
          <button
            onClick={() => setExpanded(e => !e)}
            title={expanded ? 'Collapse' : 'Expand all fields'}
            className="ml-auto flex h-5 w-[22px] shrink-0 items-center justify-center rounded text-[13px] font-bold leading-none text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          >
            {expanded ? '⇤' : '⇥'}
          </button>
        </div>

        {/* Product identity — from crawl_meta, editable via PATCH /jobs/:jobId/details */}
        {stage === 1 && (
          <>
            <div className="grid grid-cols-[40px_1fr] items-center gap-1.5">
              <span className="text-[10.5px] text-muted-foreground">Name</span>
              <input value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="—" className={cn(FIELD_BOX, 'truncate')} />
            </div>
            <div className="grid grid-cols-[40px_1fr_40px_1fr] items-center gap-1.5">
              <span className="text-[10.5px] text-muted-foreground">Brand</span>
              <input value={draftBrand} onChange={e => setDraftBrand(e.target.value)} placeholder="—" className={cn(FIELD_BOX, 'truncate')} />
              <span className="text-[10.5px] text-muted-foreground">Price</span>
              <div className="flex items-center gap-1 min-w-0">
                {product?.currency && <span className="shrink-0 text-[10.5px] text-muted-foreground">{product.currency}</span>}
                <input
                  type="number" value={draftPrice} onChange={e => setDraftPrice(e.target.value)} placeholder="—"
                  className={cn(FIELD_BOX, 'truncate')}
                />
              </div>
            </div>
            <div className="grid grid-cols-[40px_1fr] items-center gap-1.5">
              <span className="text-[10.5px] text-muted-foreground">VTon</span>
              <Select value={draftPreference} onValueChange={setDraftPreference}>
                <SelectTrigger className={FIELD_SELECT} title="Which type of photo wins the VTON pick when nothing's been manually retagged">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREFERENCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="grid grid-cols-[40px_1fr_40px_1fr] items-center gap-1.5">
          <span className="text-[10.5px] text-muted-foreground">Catgy</span>
          <Select value={draftCategory} onValueChange={setDraftCategory}>
            <SelectTrigger className={FIELD_SELECT}><SelectValue /></SelectTrigger>
            <SelectContent>
              {withCurrent(CATEGORY_OPTIONS, job.product_type).map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[10.5px] text-muted-foreground">Cmplx</span>
          <Select value={draftComplexity} onValueChange={setDraftComplexity}>
            <SelectTrigger className={FIELD_SELECT}><SelectValue /></SelectTrigger>
            <SelectContent>
              {withCurrent(COMPLEXITY_OPTIONS, job.product_complexity).map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[40px_1fr_40px_1fr] items-center gap-1.5">
          <span className="text-[10.5px] text-muted-foreground">Gendr</span>
          <Select value={draftGender} onValueChange={setDraftGender}>
            <SelectTrigger className={FIELD_SELECT}><SelectValue /></SelectTrigger>
            <SelectContent>
              {withCurrent(GENDER_OPTIONS, job.product_gender_type).map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[10.5px] text-muted-foreground">Sub</span>
          <input value={draftSub} onChange={e => setDraftSub(e.target.value)} placeholder="—" className={cn(FIELD_BOX, 'truncate')} />
        </div>

        {detailsDirty && (
          <Button size="sm" className="h-6 w-full text-[10.5px] font-semibold" disabled={updatingDetails} onClick={updateDetails}>
            {updatingDetails && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Update Details
          </Button>
        )}

        {/* Status pill + grouped action buttons */}
        <div className="mt-auto flex min-h-[24px] items-center gap-2 pt-1">
          <button
            onClick={pill.onClick}
            disabled={!pill.onClick}
            title={pill.text}
            className={cn(
              'inline-flex min-w-0 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10.5px] font-semibold',
              pill.tone, !pill.onClick && 'cursor-default'
            )}
          >
            {pill.icon} <span className="truncate">{pill.text}</span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {stage === 1 ? (
              <>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10.5px] font-semibold" disabled={rowState === 'processing' || pushed || busy !== null} onClick={() => runRestart('scraping', 'rescrape')}>
                  ↻ Scrape
                </Button>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10.5px] font-semibold" disabled={rowState === 'processing' || pushed || busy !== null} onClick={() => runRestart('identifying', 'retag')}>
                  ↻ Tag
                </Button>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10.5px] font-semibold" disabled={rowState === 'processing' || pushed || busy !== null} onClick={() => runRestart('generating_garment_summary', 'resummarize')}>
                  ↻ Summary
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10.5px] font-semibold" disabled={rowState === 'processing' || pushed || busy !== null} onClick={() => runRestart('generating_vton', 'regen-vton')}>
                  ↻ VTon
                </Button>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10.5px] font-semibold" disabled={rowState === 'processing' || pushed || busy !== null} onClick={() => runRestart('segmenting', 'resegment')}>
                  ↻ Segment
                </Button>
              </>
            )}
            <div className="w-1.5" />
            <Button
              size="sm"
              className="h-6 px-2.5 text-[10.5px] font-semibold"
              disabled={pushed || busy !== null || !(canProceed(job) || job.current_state === 'placement')}
              onClick={() => canProceed(job) ? runPush() : job.current_state === 'placement' ? onOpenPlacement(job.job_id) : undefined}
            >
              {job.current_state === 'awaiting_hitl_identification' ? 'Approve ID →'
                : job.current_state === 'awaiting_hitl_segmentation' ? 'Approve Seg →'
                : job.current_state === 'placement' ? 'Place →'
                : 'Push →'}
            </Button>
          </div>
        </div>
      </div>

      {/* Tiles — or, when expanded, the extra-fields strip in their place */}
      <div className="flex min-w-0 flex-1 items-start gap-2 overflow-x-auto border-l border-black/5 dark:border-white/5 px-3">
        {expanded ? (
          <div className="flex w-full flex-col gap-2 overflow-y-auto pt-[26px] pb-1 pr-1 text-[10.5px] text-muted-foreground">
            {garmentSummary ? (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {garmentSummary.techPack.map(entry => (
                    <span key={entry.key} className="truncate capitalize">
                      {entry.label.toLowerCase()} <span className="font-medium text-foreground normal-case">{entry.value}</span>
                    </span>
                  ))}
                  {garmentSummary.techPack.length === 0 && <span>Tech pack not parsed</span>}
                </div>
                {garmentSummary.physics && (
                  <p className="leading-relaxed">
                    <span className="font-semibold text-foreground">Feel</span> — {garmentSummary.physics.replace(/^\[GARMENT_PHYSICS\]\s*/, '')}
                  </p>
                )}
                <div className="flex gap-4">
                  <span>Care <span className="italic">not tracked by this pipeline</span></span>
                  <span>Other <span className="italic">not tracked by this pipeline</span></span>
                </div>
                <div>
                  <button
                    onClick={() => setPackOpen(o => !o)}
                    className="flex items-center gap-1 font-mono text-foreground hover:underline"
                  >
                    {packOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {'{ }'} Pack JSON
                  </button>
                  {packOpen && (
                    <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 text-[9.5px] leading-relaxed">
                      {JSON.stringify(garmentSummary.raw, null, 2)}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <p>No garment summary yet — runs after identification (↻ Summary).</p>
            )}
            <div className="grid grid-cols-[repeat(3,auto)] gap-x-6 gap-y-1.5 border-t border-border/60 pt-1.5">
              <span>VTon model <span className="font-medium text-foreground">{job.v_ton_model ?? 'auto'}</span></span>
              <span>HITL ID <span className="font-medium text-foreground">{job.hitl_post_identification ? 'on' : 'off'}</span></span>
              <span>HITL Seg <span className="font-medium text-foreground">{job.hitl_post_segmentation ? 'on' : 'off'}</span></span>
              <span>Errors <span className="font-medium text-foreground">{job.error_count}</span></span>
              <span>State <span className="font-medium text-foreground">{job.current_state}</span></span>
              {job.ingested_product_id && <span>Product ID <span className="font-mono font-medium text-foreground">{job.ingested_product_id}</span></span>}
            </div>
          </div>
        ) : stage === 1 ? (
          <>
            {SLOT_DEFS.map(({ key, label }) => {
              const slot = slots[key]
              const viewerIdx = slotViewerImages.findIndex(v => v.url === slot?.url)
              return (
                <PhotoCard
                  key={key}
                  label={label}
                  state={slot ? 'available' : rowState === 'processing' ? 'processing' : rowState === 'error' ? 'error' : 'empty'}
                  url={slot?.url}
                  badge={slot?.manual ? 'M' : slot?.uncertain ? '?' : undefined}
                  note={!slot ? (
                    rowState === 'processing' ? 'Processing…'
                    : anySlotFilled ? 'Not found in scrape'
                    : rowState === 'error' ? 'No output'
                    : 'Not scraped yet'
                  ) : undefined}
                  size="xl"
                  onExpand={slot ? () => onOpenViewer(slotViewerImages, viewerIdx) : undefined}
                />
              )
            })}
            <div className="flex w-32 shrink-0 flex-col gap-1.5">
              <PhotoCard
                label="Source"
                state={sourceImages.length > 0 ? 'available' : rowState === 'processing' ? 'processing' : rowState === 'error' ? 'error' : 'empty'}
                url={sourceImages[srcIdxClamped]}
                badge={sourceImages.length > 1 ? `${srcIdxClamped + 1}/${sourceImages.length}` : undefined}
                note={sourceImages.length === 0 ? (rowState === 'processing' ? 'Scraping…' : rowState === 'error' ? 'No output' : 'Not scraped yet') : undefined}
                size="xl"
                onExpand={sourceImages.length > 0 ? () => onOpenViewer(srcViewerImages, srcIdxClamped) : undefined}
                actions={sourceImages.length > 1 ? [
                  { icon: <ChevronLeft className="h-3 w-3" />, label: 'Previous', onClick: () => setSrcIdx((srcIdxClamped - 1 + sourceImages.length) % sourceImages.length) },
                  { icon: <ChevronRight className="h-3 w-3" />, label: 'Next', onClick: () => setSrcIdx((srcIdxClamped + 1) % sourceImages.length) },
                ] : undefined}
              />

              {/* Retag this photo — toggling here is what recomputes the 4 slots above */}
              {sourceImages.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-1.5">
                  <div className="flex gap-1">
                    {draftType !== 'Detail' && (
                      <Select value={draftView} onValueChange={v => setDraftView(v as View)}>
                        <SelectTrigger className="h-6 flex-1 px-1.5 text-[10px] [&>svg]:h-3 [&>svg]:w-3"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VIEW_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Select value={draftType} onValueChange={v => setDraftType(v as PhotoType)}>
                      <SelectTrigger className="h-6 flex-1 px-1.5 text-[10px] [&>svg]:h-3 [&>svg]:w-3"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TYPE_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="truncate text-[9.5px] text-muted-foreground">
                    {!currentTag ? 'Not classified yet'
                      : !currentBucketKey ? `${currentTag.manual ? 'Manual' : 'Auto'}: ${currentTag.type === 'Detail' ? 'Detail' : `${currentTag.view} · ${currentTag.type}`} (excluded from VTON)`
                      : isPrimary ? `★ Primary — ${currentTag.view} · ${currentTag.type}`
                      : `${currentTag.manual ? 'Manual' : 'Auto'}: ${currentTag.view} · ${currentTag.type} (not primary)`}
                  </p>
                  <div className="flex gap-1">
                    {currentBucketKey && !isPrimary && (
                      <Button
                        size="sm" variant="outline"
                        className="h-6 flex-1 px-1.5 text-[10px] font-semibold"
                        disabled={retagging}
                        onClick={() => applyTag(currentTag!.view!, currentTag!.type!)}
                        title="Make this the primary photo for its slot"
                      >
                        ★ Make Primary
                      </Button>
                    )}
                    <Button size="sm" className="h-6 flex-1 px-1.5 text-[10px] font-semibold" disabled={retagging} onClick={() => applyTag(draftView, draftType)}>
                      {retagging && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      Apply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <PhotoCard
              label="Gen"
              state={vton ? 'available' : rowState === 'error' ? 'error' : rowState === 'processing' ? 'processing' : 'empty'}
              url={vton}
              note={!vton ? (rowState === 'processing' ? 'Generating…' : rowState === 'error' ? 'No output' : undefined) : undefined}
              size="xl"
              onExpand={vton ? () => onOpenViewer([{ url: vton, label: 'Generated' }], 0) : undefined}
            />
            <PhotoCard
              label="Sgmtd"
              state={job.segmented_image_url ? 'available' : rowState === 'processing' ? 'processing' : 'empty'}
              url={job.segmented_image_url}
              note={!job.segmented_image_url ? 'Waiting on Gen' : 'Click ✎ to erase (HITL)'}
              size="xl"
              onExpand={job.segmented_image_url ? () => onOpenEraser(job.job_id) : undefined}
              actions={job.segmented_image_url ? [
                { icon: <Eraser className="h-3 w-3" />, label: 'AI eraser', onClick: () => onOpenEraser(job.job_id) },
              ] : undefined}
            />
            <PhotoCard
              label="Placed"
              state="empty"
              note={job.current_state === 'placement' ? 'Use placement editor' : pushed ? 'Pushed to catalog' : 'Waiting on Sgmtd'}
              size="xl"
            />
          </>
        )}
      </div>
      {dialog}
    </div>
  )
}
