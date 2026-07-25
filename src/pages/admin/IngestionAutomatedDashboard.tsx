import { useState } from 'react'
import { AppShellLayout } from '@/layouts/AppShellLayout'
import { useQueueState } from '@/components/ingestion-automated/useQueueState'
import { useImageClassification } from '@/components/ingestion-automated/useImageClassification'
import { useVtonSelection } from '@/components/ingestion-automated/useVtonSelection'
import { useSourceImages } from '@/components/ingestion-automated/useSourceImages'
import { useProductMeta } from '@/components/ingestion-automated/useProductMeta'
import { usePlacementImage } from '@/components/ingestion-automated/usePlacementImage'
import { useCatalogStatus } from '@/components/ingestion-automated/useCatalogStatus'
import { useGarmentSummary } from '@/components/ingestion-automated/useGarmentSummary'
import { QueueSidebar } from '@/components/ingestion-automated/QueueSidebar'
import { RowItem } from '@/components/ingestion-automated/RowItem'
import { ItemDetailPage } from '@/components/ingestion-automated/ItemDetailPage'
import { AddItemDialog } from '@/components/ingestion-automated/AddItemDialog'
import { PlacementMeshEditor } from '@/components/ingestion-automated/PlacementMeshEditor'
import { PhotoViewerDialog, type ViewerImage } from '@/components/ingestion-automated/PhotoViewerDialog'
import { SegmentEraserDialog } from '@/components/ingestion-automated/SegmentEraserDialog'
import { ErrorAttentionDialog } from '@/components/ingestion-automated/ErrorAttentionDialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { v2Api } from '@/utils/ingestionV2Api'

export default function IngestionAutomatedDashboard() {
  const queue = useQueueState()
  const [detailJobId, setDetailJobId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [eraserJobId, setEraserJobId] = useState<string | null>(null)
  const [meshJobId, setMeshJobId] = useState<string | null>(null)
  const [errorJobId, setErrorJobId] = useState<string | null>(null)
  const [highlightJobId, setHighlightJobId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number; open: boolean; jobId?: string }>({ images: [], index: 0, open: false })
  const { toast } = useToast()

  const { tags: classifications, refetch: refetchTags } = useImageClassification(queue.paged.map(p => p.job))
  const { selections, refetch: refetchSelection } = useVtonSelection(queue.paged.map(p => p.job))
  const sourceImages = useSourceImages(queue.paged.map(p => p.job))
  const { products: productMeta, refetch: refetchProduct } = useProductMeta(queue.paged.map(p => p.job))
  const { placements, refetch: refetchPlacement } = usePlacementImage(queue.paged.map(p => p.job))
  const { statuses: catalogStatus, refetch: refetchCatalog } = useCatalogStatus(queue.paged.map(p => p.job))
  const garmentSummaries = useGarmentSummary(queue.paged.map(p => p.job))
  const eraserJob = queue.jobs.find(j => j.job_id === eraserJobId) ?? null
  const errorJob = queue.jobs.find(j => j.job_id === errorJobId) ?? null

  // Flash a row (e.g. the original of a duplicate submit) and auto-clear.
  const highlight = (jobId: string) => {
    setHighlightJobId(jobId)
    window.setTimeout(() => setHighlightJobId(cur => (cur === jobId ? null : cur)), 4000)
  }

  return (
    <AppShellLayout>
      <div className="flex h-full overflow-hidden">
        <QueueSidebar queue={queue} onAddItem={() => setAddOpen(true)} />

        <div className="flex-1 overflow-y-auto p-3">
          {queue.loading && queue.jobs.length === 0 ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
            </div>
          ) : queue.error ? (
            <p className="text-sm text-destructive p-4">{queue.error}</p>
          ) : queue.paged.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
              <span className="text-2xl text-muted-foreground/40">⌀</span>
              <p className="text-sm text-muted-foreground">No items match</p>
              <button onClick={queue.actions.clearAllFilters} className="text-xs text-primary underline underline-offset-2">
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {queue.paged.map(({ job, stage }) => (
                <RowItem
                  key={job.job_id}
                  job={job}
                  stage={stage}
                  tags={classifications[job.job_id] ?? []}
                  selection={selections[job.job_id]}
                  sourceImages={sourceImages[job.job_id] ?? []}
                  product={productMeta[job.job_id]}
                  refetchProduct={refetchProduct}
                  placementImage={placements[job.job_id]?.url}
                  onOpenMesh={setMeshJobId}
                  catalogStatus={catalogStatus[job.job_id]}
                  onPublished={() => { refetchCatalog(); queue.refetch() }}
                  highlighted={highlightJobId === job.job_id}
                  garmentSummary={garmentSummaries[job.job_id]}
                  selected={queue.model.selected.has(job.job_id)}
                  onToggleSelect={queue.actions.toggleSelect}
                  onOpenDetail={setDetailJobId}
                  onOpenError={setErrorJobId}
                  onOpenPlacement={setMeshJobId}
                  onOpenViewer={(images, index, viewerJobId) => setViewer({ images, index, open: true, jobId: viewerJobId })}
                  onOpenEraser={setEraserJobId}
                  refetch={queue.refetch}
                  refetchSelection={refetchSelection}
                  refetchTags={refetchTags}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {detailJobId && (
        <ItemDetailPage jobId={detailJobId} onClose={() => setDetailJobId(null)} />
      )}

      <AddItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={(jobId) => { queue.refetch(); setDetailJobId(jobId) }}
        onDuplicate={(jobId) => { queue.refetch(); highlight(jobId) }}
      />

      <SegmentEraserDialog
        job={eraserJob}
        open={eraserJobId !== null}
        onOpenChange={(o) => !o && setEraserJobId(null)}
        onSaved={queue.refetch}
      />

      <ErrorAttentionDialog
        job={errorJob}
        open={errorJobId !== null}
        onOpenChange={(o) => !o && setErrorJobId(null)}
        onOpenPlacement={setMeshJobId}
        refetch={queue.refetch}
      />

      <PlacementMeshEditor
        job={queue.jobs.find(j => j.job_id === meshJobId) ?? null}
        placement={meshJobId ? placements[meshJobId] : undefined}
        open={meshJobId !== null}
        onOpenChange={(o) => !o && setMeshJobId(null)}
        onSaved={() => { refetchPlacement(); queue.refetch() }}
      />

      <PhotoViewerDialog
        images={viewer.images}
        index={viewer.index}
        onIndexChange={(i) => setViewer(v => ({ ...v, index: i }))}
        open={viewer.open}
        onOpenChange={(o) => setViewer(v => ({ ...v, open: o }))}
        jobId={viewer.jobId}
        preferredUrl={viewer.jobId ? (queue.jobs.find(j => j.job_id === viewer.jobId)?.v_ton_preferred_image ?? null) : null}
        onRetag={async (url, view, type) => {
          if (!viewer.jobId) return
          try {
            await v2Api.retagPhoto(viewer.jobId, { image_url: url, type, ...(type !== 'Detail' && { view }) })
            toast({ title: 'Photo retagged' })
            refetchSelection(); refetchTags(); queue.refetch()
          } catch (e) {
            toast({ title: 'Retag failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
          }
        }}
        onDeletePhoto={async (url) => {
          if (!viewer.jobId) return
          try {
            const res = await v2Api.deletePhoto(viewer.jobId, url)
            toast(res.warning === 'no_usable_image'
              ? { title: 'Photo deleted', description: 'No usable photo left — re-scrape this item.' }
              : { title: 'Photo deleted' })
            refetchSelection(); refetchTags(); queue.refetch()
            setViewer(v => {
              const imgs = v.images.filter(i => i.url !== url)
              return imgs.length ? { ...v, images: imgs, index: Math.min(v.index, imgs.length - 1) } : { ...v, images: [], open: false }
            })
          } catch (e) {
            toast({ title: 'Delete failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
          }
        }}
      />
    </AppShellLayout>
  )
}
