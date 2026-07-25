import { useState } from 'react'
import { AppShellLayout } from '@/layouts/AppShellLayout'
import { useQueueState } from '@/components/ingestion-automated/useQueueState'
import { useImageClassification } from '@/components/ingestion-automated/useImageClassification'
import { useVtonSelection } from '@/components/ingestion-automated/useVtonSelection'
import { useSourceImages } from '@/components/ingestion-automated/useSourceImages'
import { useProductMeta } from '@/components/ingestion-automated/useProductMeta'
import { useGarmentSummary } from '@/components/ingestion-automated/useGarmentSummary'
import { QueueSidebar } from '@/components/ingestion-automated/QueueSidebar'
import { RowItem } from '@/components/ingestion-automated/RowItem'
import { ItemDetailPage } from '@/components/ingestion-automated/ItemDetailPage'
import { AddItemDialog } from '@/components/ingestion-automated/AddItemDialog'
import { PlacementEditorDialog } from '@/components/ingestion-automated/PlacementEditorDialog'
import { PhotoViewerDialog, type ViewerImage } from '@/components/ingestion-automated/PhotoViewerDialog'
import { SegmentEraserDialog } from '@/components/ingestion-automated/SegmentEraserDialog'
import { ErrorAttentionDialog } from '@/components/ingestion-automated/ErrorAttentionDialog'
import { Skeleton } from '@/components/ui/skeleton'

export default function IngestionAutomatedDashboard() {
  const queue = useQueueState()
  const [detailJobId, setDetailJobId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [placementJobId, setPlacementJobId] = useState<string | null>(null)
  const [eraserJobId, setEraserJobId] = useState<string | null>(null)
  const [errorJobId, setErrorJobId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number; open: boolean }>({ images: [], index: 0, open: false })

  const { tags: classifications, refetch: refetchTags } = useImageClassification(queue.paged.map(p => p.job))
  const { selections, refetch: refetchSelection } = useVtonSelection(queue.paged.map(p => p.job))
  const sourceImages = useSourceImages(queue.paged.map(p => p.job))
  const { products: productMeta, refetch: refetchProduct } = useProductMeta(queue.paged.map(p => p.job))
  const garmentSummaries = useGarmentSummary(queue.paged.map(p => p.job))
  const placementJob = queue.jobs.find(j => j.job_id === placementJobId) ?? null
  const eraserJob = queue.jobs.find(j => j.job_id === eraserJobId) ?? null
  const errorJob = queue.jobs.find(j => j.job_id === errorJobId) ?? null

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
                  garmentSummary={garmentSummaries[job.job_id]}
                  selected={queue.model.selected.has(job.job_id)}
                  onToggleSelect={queue.actions.toggleSelect}
                  onOpenDetail={setDetailJobId}
                  onOpenError={setErrorJobId}
                  onOpenPlacement={setPlacementJobId}
                  onOpenViewer={(images, index) => setViewer({ images, index, open: true })}
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
      />

      <PlacementEditorDialog
        job={placementJob}
        open={placementJobId !== null}
        onOpenChange={(o) => !o && setPlacementJobId(null)}
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
        onOpenPlacement={setPlacementJobId}
        refetch={queue.refetch}
      />

      <PhotoViewerDialog
        images={viewer.images}
        index={viewer.index}
        onIndexChange={(i) => setViewer(v => ({ ...v, index: i }))}
        open={viewer.open}
        onOpenChange={(o) => setViewer(v => ({ ...v, open: o }))}
      />
    </AppShellLayout>
  )
}
