import { useState } from 'react'
import { format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useIngestionV2Job } from '@/hooks/useIngestionV2Job'
import { v2Api, type UpdateJobDetailsBody } from '@/utils/ingestionV2Api'
import { useProductMeta } from './useProductMeta'
import { useGarmentSummary } from './useGarmentSummary'
import { useVtonSelection, EMPTY_SLOTS, type SlotMap } from './useVtonSelection'
import { usePlacementImage } from './usePlacementImage'
import { useSourceImages } from './useSourceImages'
import { stageOf, canProceed } from './stateMapping'
import { ItemDetailView, type EditableField, type ItemDetailImages } from './ItemDetailView'
import { ConfirmDialog } from './ConfirmDialog'

type Props = {
  jobId: string
  onClose: () => void
}

const SLOT_DEFS: { key: keyof SlotMap; label: string }[] = [
  { key: 'frontModel', label: 'Front · Mod' },
  { key: 'frontFlat', label: 'Front · Flt' },
  { key: 'backModel', label: 'Back · Mod' },
  { key: 'backFlat', label: 'Back · Flt' },
]

const GENDER_OPTS = [{ value: 'female', label: 'female' }, { value: 'male', label: 'male' }, { value: 'unisex', label: 'unisex' }]
const CATEGORY_OPTS = [{ value: 'topwear', label: 'topwear' }, { value: 'bottomwear', label: 'bottomwear' }, { value: 'dress', label: 'dress' }]

// Keep the job's actual value selectable even when it isn't one of the standard enums.
const withCurrent = (opts: { value: string; label: string }[], cur: string) =>
  !cur || opts.some(o => o.value === cur) ? opts : [{ value: cur, label: cur }, ...opts]

// Data container for the Item Detail full page. Wires the real ingestion hooks + v2Api and
// hands everything to the presentational <ItemDetailView/>. Keeps its { jobId, onClose } props
// so the dashboard wiring is unchanged.
export function ItemDetailPage({ jobId, onClose }: Props) {
  const { job, artifacts, loading, error, refetch } = useIngestionV2Job(jobId)
  const jobsArr = job ? [job] : []
  const { products, refetch: refetchProduct } = useProductMeta(jobsArr)
  const garmentSummaries = useGarmentSummary(jobsArr)
  const { selections } = useVtonSelection(jobsArr)
  const { placements } = usePlacementImage(jobsArr)
  const sourceImages = useSourceImages(jobsArr)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { toast } = useToast()

  if (loading && !job) {
    return (
      <Shell onClose={onClose}>
        <div className="flex flex-col gap-4 p-5">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Shell>
    )
  }

  if (error || !job) {
    return (
      <Shell onClose={onClose}>
        <p className="p-5 text-sm text-destructive">{error ?? 'Job not found'}</p>
      </Shell>
    )
  }

  const stage = stageOf(job)
  const productMeta = products[job.job_id]
  const garmentSummary = garmentSummaries[job.job_id]
  const slots = selections[job.job_id]?.slots ?? EMPTY_SLOTS
  const placement = placements[job.job_id]
  const rawCount = sourceImages[job.job_id]?.length ?? 0

  const images: ItemDetailImages = {
    stage1Slots: SLOT_DEFS.map(({ key, label }) => ({
      label,
      url: slots[key]?.url ?? null,
      note: slots[key] ? undefined : 'Not found',
      badge: slots[key]?.manual ? 'M' : slots[key]?.uncertain ? '?' : undefined,
    })),
    submittedCount: rawCount,
    gen: job.vton_image_url ?? job.v_ton_preferred_image,
    segmented: job.segmented_image_url,
    placed: placement?.url ?? null,
  }

  const editableFields: EditableField[] = [
    { kind: 'text', key: 'product_name', label: 'Name', value: productMeta?.name ?? '' },
    { kind: 'text', key: 'brand', label: 'Brand', value: productMeta?.brand ?? '' },
    { kind: 'text', key: 'price', label: 'Price', value: productMeta?.price != null ? String(productMeta.price) : '', mono: true, type: 'number' },
    { kind: 'select', key: 'product_gender_type', label: 'Gender', value: job.product_gender_type, options: withCurrent(GENDER_OPTS, job.product_gender_type) },
    { kind: 'select', key: 'product_type', label: 'Category', value: job.product_type, options: withCurrent(CATEGORY_OPTS, job.product_type) },
    { kind: 'text', key: 'product_sub_type', label: 'Sub-category', value: job.product_sub_type ?? '' },
  ]

  const name = productMeta?.name || job.product_url
  const meta = [
    job.product_gender_type, job.product_type, job.product_sub_type || null,
    job.created_by, format(new Date(job.created_at), 'd MMM'),
  ].filter(Boolean).join(' · ')
  const summary = garmentSummary?.physics ?? garmentSummary?.colorAndFabric ?? null
  const scrapedMeta = (artifacts.find(a => a.artifact_type === 'crawl_meta')?.data as Record<string, unknown> | undefined) ?? null

  const saveField = async (key: string, value: string) => {
    const patch: UpdateJobDetailsBody = {}
    switch (key) {
      case 'product_name': patch.product_name = value; break
      case 'brand': patch.brand = value; break
      case 'price': {
        const n = Number(value)
        if (value.trim() !== '' && !Number.isNaN(n)) patch.price = n
        break
      }
      case 'product_gender_type': patch.product_gender_type = value as UpdateJobDetailsBody['product_gender_type']; break
      case 'product_type': patch.product_type = value as UpdateJobDetailsBody['product_type']; break
      case 'product_sub_type': patch.product_sub_type = value; break
      default: return
    }
    if (Object.keys(patch).length === 0) return
    try {
      await v2Api.updateJobDetails(job.job_id, patch)
      toast({ title: 'Saved' })
      refetch()
      refetchProduct()
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

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

  const onProceed = async () => {
    setBusy('proceed')
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

  const performDelete = async () => {
    setBusy('delete')
    try {
      await v2Api.deleteJob(job.job_id)
      toast({ title: 'Job deleted' })
      onClose()
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
      setBusy(null)
    }
  }

  return (
    <>
    <ItemDetailView
      job={job}
      stage={stage}
      name={name}
      meta={meta}
      productMeta={productMeta}
      garmentSummary={garmentSummary}
      images={images}
      editableFields={editableFields}
      summary={summary}
      scrapedMeta={scrapedMeta}
      canProceed={canProceed(job)}
      onClose={onClose}
      onRescrape={() => runRestart('scraping', 'rescrape')}
      onRedo={() => runRestart(job.last_error_step ?? 'generating_vton', 'redo')}
      onResegment={() => runRestart('segmenting', 'resegment')}
      onReplace={() => runRestart('placement', 'replace')}
      onDelete={() => setConfirmDelete(true)}
      onProceed={onProceed}
      onSaveField={saveField}
      busy={busy}
    />
    <ConfirmDialog
      open={confirmDelete}
      onOpenChange={setConfirmDelete}
      title="Delete this item?"
      description="This removes the job and all its data — scraped images, artifacts, and any catalog entry. It cannot be undone."
      confirmLabel="Delete"
      destructive
      onConfirm={performDelete}
    />
    </>
  )
}

// Minimal chrome for the loading / error states, matching the detail page's full-screen shell.
function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex flex-none items-center gap-3 border-b border-border bg-card px-5 py-3">
        <button onClick={onClose} className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Queue
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
