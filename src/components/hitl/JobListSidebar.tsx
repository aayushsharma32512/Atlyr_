import { useCallback, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { IngestionJobSummary, useJobList } from '@/hooks/useJobList'
import { useToast } from '@/hooks/use-toast'
import { cancelIngestionJob, deleteIngestionJob, requeueIngestionJob } from '@/utils/ingestionApi'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { Ban, RefreshCcw, Search, Trash2, TriangleAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type JobListSidebarProps = {
  selectedJobId?: string | null
  onSelectJob: (jobId: string | null) => void
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  ingesting: 'Ingesting',
  awaiting_phase1: 'Awaiting Phase 1',
  phase1_complete: 'Phase 1 Complete',
  awaiting_phase2: 'Awaiting Phase 2',
  promoting: 'Promoting',
  completed: 'Completed',
  cancelled: 'Cancelled',
  errored: 'Errored',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  queued: 'outline',
  ingesting: 'secondary',
  awaiting_phase1: 'default',
  phase1_complete: 'default',
  awaiting_phase2: 'default',
  promoting: 'secondary',
  completed: 'outline',
  cancelled: 'outline',
  errored: 'destructive',
}

function JobRow({ job, selected, onSelect }: { job: IngestionJobSummary; selected: boolean; onSelect: () => void }) {
  const statusKey = job.status in STATUS_LABELS ? job.status : 'queued'
  const statusLabel = STATUS_LABELS[statusKey] ?? job.status
  const statusVariant = STATUS_VARIANTS[statusKey] ?? 'outline'
  const createdLabel = useMemo(() => formatDistanceToNow(new Date(job.created_at), { addSuffix: true }), [job.created_at])
  const batchLabel = typeof job.batch_label === 'string' && job.batch_label.trim().length > 0 ? job.batch_label.trim() : null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-[315px] rounded-lg border p-2 pr-3 text-left transition-colors hover:bg-muted',
          selected ? 'border-primary bg-primary/5' : 'border-border bg-card'
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <Badge variant={statusVariant} className="text-xs capitalize">
            {statusLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">{createdLabel}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs2 font-small">{job.original_url}</p>
        <div className="mt-1 flex items-center gap-2 text-xs2 text-muted-foreground">
          <span>{job.domain}</span>
          {job.batch_id && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {batchLabel ? `Batch: ${batchLabel}` : 'Batch'}
            </Badge>
          )}
          {job.error_count > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <TriangleAlert className="h-3 w-3" />
              {job.error_count}
            </span>
          )}
        </div>
      </button>
    </div>
  )
}

export function JobListSidebar({ selectedJobId, onSelectJob }: JobListSidebarProps) {
  const searchRef = useRef<HTMLInputElement | null>(null)
  const { jobs, status, error, refresh, setFilters, filters } = useJobList({ autoRefresh: true, limit: 30 })
  const { toast } = useToast()
  const [hideCompleted, setHideCompleted] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<IngestionJobSummary | null>(null)
  const [actionPending, setActionPending] = useState<{ jobId: string; action: 'cancel' | 'delete' | 'requeue' } | null>(null)

  const handleSearchSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const value = searchRef.current?.value?.trim() ?? ''
      setFilters({ ...filters, search: value || undefined })
    },
    [filters, setFilters]
  )

  const handleStatusFilter = useCallback(
    (statusValue?: string) => {
      setFilters({ ...filters, status: statusValue })
    },
    [filters, setFilters]
  )

  const visibleJobs = useMemo(() => {
    if (!hideCompleted || filters.status === 'completed') return jobs
    return jobs.filter((job) => job.status !== 'completed')
  }, [filters.status, hideCompleted, jobs])

  const handleCancelJob = useCallback(async (job: IngestionJobSummary) => {
    if (actionPending) return
    setActionPending({ jobId: job.job_id, action: 'cancel' })
    try {
      await cancelIngestionJob(job.job_id)
      toast({ title: 'Job cancelled' })
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cancel failed'
      toast({ title: 'Cancel failed', description: message, variant: 'destructive' })
    } finally {
      setActionPending(null)
    }
  }, [actionPending, refresh, toast])

  const handleRequeueJob = useCallback(async (job: IngestionJobSummary) => {
    if (actionPending) return
    setActionPending({ jobId: job.job_id, action: 'requeue' })
    try {
      await requeueIngestionJob(job.job_id)
      toast({ title: 'Job requeued' })
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Requeue failed'
      toast({ title: 'Requeue failed', description: message, variant: 'destructive' })
    } finally {
      setActionPending(null)
    }
  }, [actionPending, refresh, toast])

  const confirmDeleteJob = useCallback((job: IngestionJobSummary) => {
    setDeleteTarget(job)
  }, [])

  const handleDeleteJob = useCallback(async () => {
    if (!deleteTarget || actionPending) return
    setActionPending({ jobId: deleteTarget.job_id, action: 'delete' })
    try {
      await deleteIngestionJob(deleteTarget.job_id)
      toast({ title: 'Job deleted' })
      if (selectedJobId === deleteTarget.job_id) {
        onSelectJob(null)
      }
      setDeleteTarget(null)
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed'
      toast({ title: 'Delete failed', description: message, variant: 'destructive' })
    } finally {
      setActionPending(null)
    }
  }, [actionPending, deleteTarget, onSelectJob, refresh, selectedJobId, toast])

  return (
    <div className="flex h-full w-full flex-col border-r bg-background">
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the ingestion job, its state, and any created products/images from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="break-all"><span className="font-medium text-foreground">Job:</span> {deleteTarget.job_id}</div>
              <div className="break-all"><span className="font-medium text-foreground">URL:</span> {deleteTarget.original_url}</div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionPending?.action === 'delete'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteJob()
              }}
              disabled={!deleteTarget || actionPending?.action === 'delete'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionPending?.action === 'delete' ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="border-b p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Job Queue</h2>
          <Button size="icon" variant="ghost" onClick={() => refresh()} title="Refresh jobs">
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
        <form className="flex items-center gap-2" onSubmit={handleSearchSubmit}>
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              defaultValue={filters.search ?? ''}
              placeholder="Search URLs or job IDs"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {[
            { value: undefined, label: 'All' },
            { value: 'queued', label: 'Queued' },
            { value: 'ingesting', label: 'Ingesting' },
            { value: 'awaiting_phase1', label: 'Awaiting P1' },
            { value: 'awaiting_phase2', label: 'Awaiting P2' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'completed', label: 'Completed' },
            { value: 'errored', label: 'Errors' },
          ].map((filter) => (
            <Button
              key={filter.label}
              type="button"
              variant={filters.status === filter.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleStatusFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant={hideCompleted ? 'default' : 'outline'}
          size="sm"
          onClick={() => setHideCompleted((prev) => !prev)}
          disabled={filters.status === 'completed'}
          title={filters.status === 'completed' ? 'Showing only completed jobs' : undefined}
        >
          {hideCompleted ? 'Hide completed: On' : 'Hide completed: Off'}
        </Button>
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {status === 'loading' && jobs.length === 0 && (
            <>
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-lg" />
              ))}
            </>
          )}
          {visibleJobs.map((job) => {
            const isSelected = selectedJobId === job.job_id
            const isTerminal = job.status === 'completed' || job.status === 'errored' || job.status === 'cancelled'
            const canCancel = !isTerminal
            const canDelete = isTerminal
            const cancelPending = actionPending?.jobId === job.job_id && actionPending.action === 'cancel'
            const canRequeue = job.status === 'queued' || job.status === 'errored'
            const requeuePending = actionPending?.jobId === job.job_id && actionPending.action === 'requeue'

            return (
              <div key={job.job_id} className="relative">
                <JobRow job={job} selected={isSelected} onSelect={() => onSelectJob(job.job_id)} />
                <div className="absolute right-[2px] bottom-[2px] z-10 flex items-center gap-1">
                  {canRequeue && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleRequeueJob(job)
                      }}
                      disabled={Boolean(actionPending) || !canRequeue}
                      title="Requeue job"
                    >
                      <RefreshCcw className={cn('h-4 w-4', requeuePending ? 'animate-spin' : undefined)} />
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleCancelJob(job)
                      }}
                      disabled={Boolean(actionPending) || !canCancel}
                      title="Cancel job"
                    >
                      <Ban className={cn('h-4 w-4', cancelPending ? 'animate-pulse' : undefined)} />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation()
                      confirmDeleteJob(job)
                    }}
                    disabled={!canDelete || Boolean(actionPending)}
                    title={canDelete ? 'Delete job' : 'Cancel the job before deleting'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
          {jobs.length === 0 && status !== 'loading' && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No jobs found. Submit URLs to start ingesting products.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
