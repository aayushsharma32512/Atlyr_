import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIngestionV2Job } from '@/hooks/useIngestionV2Job'
import { ImagePreviewStrip } from '@/components/ingestion-v2/ImagePreviewStrip'
import { StepDetailsAccordion } from '@/components/ingestion-v2/StepDetailsAccordion'
import { JobStateControl } from '@/components/ingestion-v2/JobStateControl'
import { STATE_LABELS, STATE_VARIANTS } from '@/components/ingestion-v2/constants'
import { useNotWiredDialog } from './NotWiredDialog'

type Props = {
  jobId: string
  onClose: () => void
}

export function ItemDetailPage({ jobId, onClose }: Props) {
  const { job, artifacts, loading, error, refetch } = useIngestionV2Job(jobId)
  const { notify, dialog } = useNotWiredDialog()

  return (
    <div className="fixed inset-0 z-40 bg-background overflow-y-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 backdrop-blur px-5 py-3">
        <button onClick={onClose} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft className="h-4 w-4" /> Queue
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{job?.product_url ?? jobId}</p>
        </div>
        {job && (
          <>
            <Badge variant={STATE_VARIANTS[job.current_state] ?? 'outline'} className="shrink-0">
              {STATE_LABELS[job.current_state] ?? job.current_state}
            </Badge>
            <a href={job.product_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline underline-offset-2 shrink-0 flex items-center gap-0.5">
              <ExternalLink className="h-3 w-3" /> Source
            </a>
            <button onClick={() => notify('Delete job')} className="text-muted-foreground hover:text-destructive shrink-0">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-5 py-6 flex flex-col gap-5">
        {loading && !job && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {(error || (!loading && !job)) && (
          <p className="text-sm text-destructive">{error ?? 'Job not found'}</p>
        )}

        {job && (
          <>
            {/* Attributes card — real fields only, no PATCH endpoint yet so read-only */}
            <div className="rounded-lg border border-border p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Gender" value={job.product_gender_type} />
              <Field label="Category" value={job.product_type} />
              <Field label="Sub-category" value={job.product_sub_type || '—'} />
              <Field label="Complexity" value={job.product_complexity} />
              <Field label="VTon model" value={job.v_ton_model ?? 'auto'} />
              <Field label="HITL — Identification" value={job.hitl_post_identification ? 'On' : 'Off'} />
              <Field label="HITL — Segmentation" value={job.hitl_post_segmentation ? 'On' : 'Off'} />
              <Field label="Submitted" value={formatDistanceToNow(new Date(job.created_at), { addSuffix: true })} />
              {job.ingested_product_id && <Field label="Product ID" value={job.ingested_product_id} mono />}
              {job.error_count > 0 && <Field label="Error count" value={String(job.error_count)} />}
            </div>

            <ImagePreviewStrip job={job} artifacts={artifacts} />

            <Tabs defaultValue="steps">
              <TabsList className="h-8">
                <TabsTrigger value="steps" className="text-xs">Step Details</TabsTrigger>
                <TabsTrigger value="controls" className="text-xs">Controls</TabsTrigger>
              </TabsList>
              <TabsContent value="steps" className="mt-4">
                <StepDetailsAccordion job={job} artifacts={artifacts} />
              </TabsContent>
              <TabsContent value="controls" className="mt-4">
                <JobStateControl job={job} onRefetch={refetch} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
      {dialog}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={mono ? 'text-xs font-mono truncate' : 'text-sm'}>{value}</p>
    </div>
  )
}
