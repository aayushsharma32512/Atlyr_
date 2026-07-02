import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIngestionV2Job } from '@/hooks/useIngestionV2Job'
import { ImagePreviewStrip } from './ImagePreviewStrip'
import { StepDetailsAccordion } from './StepDetailsAccordion'
import { JobStateControl } from './JobStateControl'
import { STATE_LABELS, STATE_VARIANTS } from './constants'

const STEP_TOTAL = 7

const STATE_STEP_INDEX: Record<string, number> = {
  pending: 0,
  scraping: 1, scraped: 1,
  identifying: 2, identified: 2, awaiting_hitl_identification: 2,
  generating_garment_summary: 3, garment_summary_generated: 3,
  generating_vton: 4, vton_generated: 4,
  segmenting: 5, segmented: 5, awaiting_hitl_segmentation: 5,
  placement: 6,
  completed: 7,
}

type Props = { jobId: string }

export function JobDetailPanel({ jobId }: Props) {
  const { job, artifacts, loading, error, refetch } = useIngestionV2Job(jobId)

  if (loading && !job) {
    return (
      <div className="p-6 flex flex-col gap-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="p-6 text-sm text-destructive">
        {error ?? 'Job not found'}
      </div>
    )
  }

  const stepIdx = STATE_STEP_INDEX[job.current_state] ?? 0
  const progressPct = Math.round((stepIdx / STEP_TOTAL) * 100)
  const isFailed = job.current_state === 'failed'
  const isDone = job.current_state === 'completed'

  return (
    <div className="flex flex-col gap-5 p-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground truncate mb-1">{job.product_url}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATE_VARIANTS[job.current_state] ?? 'outline'}>
              {STATE_LABELS[job.current_state] ?? job.current_state}
            </Badge>
            <Badge variant="outline" className="text-[10px]">{job.product_gender_type}</Badge>
            <Badge variant="outline" className="text-[10px]">{job.product_type}</Badge>
            {job.v_ton_model && <Badge variant="outline" className="text-[10px]">{job.v_ton_model}</Badge>}
            {job.hitl_post_identification && <Badge variant="outline" className="text-[10px]">HITL:ID</Badge>}
            {job.hitl_post_segmentation && <Badge variant="outline" className="text-[10px]">HITL:Seg</Badge>}
          </div>
        </div>
        <p className="text-xs text-muted-foreground shrink-0">
          {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
        </p>
      </div>

      {/* Progress bar */}
      {!isDone && !isFailed && (
        <div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Step {stepIdx} of {STEP_TOTAL} — {STATE_LABELS[job.current_state] ?? job.current_state}
          </p>
        </div>
      )}

      {/* Image strip */}
      <ImagePreviewStrip job={job} artifacts={artifacts} />

      <div className="border-t border-border" />

      {/* Detail tabs */}
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

    </div>
  )
}
