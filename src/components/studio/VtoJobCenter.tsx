import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Clock, Sparkles, Check } from 'lucide-react'

export type VtoJobKind = 'likeness' | 'generation'
export type VtoJobStatus = 'queued' | 'in-progress' | 'awaiting-user' | 'completed' | 'error'

export type VtoJobStage = {
  id: string
  label: string
  durationMs?: number
}

export type VtoJob = {
  id: string
  kind: VtoJobKind
  title: string
  status: VtoJobStatus
  createdAt: number
  startedAt?: number | null
  etaSeconds?: number
  message?: string
  resultUrl?: string | null
  error?: string | null
  stages?: VtoJobStage[]
  metadata?: Record<string, any>
}

interface VtoJobCenterProps {
  jobs: VtoJob[]
  onReviewJob?: (jobId: string) => void
  onViewResult?: (jobId: string) => void
  onCancelJob?: (jobId: string) => void
}

function useNow(refreshMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])
  return now
}

function formatRemaining(job: VtoJob, now: number) {
  if (!job.startedAt || !job.etaSeconds) return null
  if (job.status === 'completed') return null
  const elapsedSeconds = Math.floor((now - job.startedAt) / 1000)
  const remaining = Math.max(job.etaSeconds - elapsedSeconds, 0)
  if (remaining === 0) return '<1s'
  if (remaining < 60) return `${remaining}s`
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  return `${minutes}m ${seconds}s`
}

function computeStageState(job: VtoJob, stageIndex: number, now: number) {
  if (!job.stages || !job.startedAt) return 'pending'
  if (job.status === 'completed' || job.status === 'awaiting-user') return 'complete'
  if (job.status === 'error') return 'pending'

  const elapsed = now - job.startedAt
  let cumulativeBefore = 0
  for (let i = 0; i < stageIndex; i += 1) {
    cumulativeBefore += job.stages[i].durationMs ?? 0
  }
  const currentStageDuration = job.stages[stageIndex].durationMs ?? 0

  if (elapsed >= cumulativeBefore + currentStageDuration) {
    return 'complete'
  }
  if (elapsed >= cumulativeBefore) {
    return 'active'
  }
  return 'pending'
}

function computeProgress(job: VtoJob, now: number) {
  if (!job.startedAt || !job.etaSeconds) return null
  if (job.status !== 'in-progress') return null
  const elapsedSeconds = Math.max((now - job.startedAt) / 1000, 0)
  const percent = Math.min(elapsedSeconds / job.etaSeconds, 1)
  return Math.max(0, Math.min(percent, 1))
}

function getPrimaryHeadline(job: VtoJob) {
  if (job.kind === 'likeness') {
    return job.status === 'completed' ? 'Likeness ready' : 'Creating your likeness'
  }
  if (job.status === 'completed') return 'Try-on ready'
  if (job.status === 'awaiting-user') return 'Action needed'
  return 'Virtual try-on in progress'
}

function getPrimaryStatusLabel(job: VtoJob) {
  if (job.message) {
    return job.message.replace(/\.+$/, '')
  }
  if (job.status === 'queued') return 'Waiting to start'
  if (job.status === 'completed') return 'Ready to view'
  if (job.status === 'awaiting-user') return 'Needs your input'
  return job.status.replace('-', ' ')
}

export function VtoJobCenter({ jobs, onReviewJob, onViewResult, onCancelJob }: VtoJobCenterProps) {
  const [open, setOpen] = useState(false)
  const now = useNow(1000)

  const activeCount = useMemo(() => (
    jobs.filter(job => job.status === 'in-progress' || job.status === 'queued' || job.status === 'awaiting-user').length
  ), [jobs])

  const sortedJobs = useMemo(() => {
    const priority = { 'in-progress': 0, 'awaiting-user': 1, 'queued': 2, 'completed': 3, 'error': 4 }
    return [...jobs].sort((a, b) => {
      const statusDiff = priority[a.status] - priority[b.status]
      if (statusDiff !== 0) return statusDiff
      return b.createdAt - a.createdAt
    })
  }, [jobs])

  const primaryJob = sortedJobs[0]
  const primaryRemaining = primaryJob ? formatRemaining(primaryJob, now) : null
  const primaryProgress = primaryJob ? computeProgress(primaryJob, now) : null

  const hasJobs = sortedJobs.length > 0

  function handlePrimaryAction() {
    if (!primaryJob) return
    if (primaryJob.status === 'awaiting-user' && onReviewJob) {
      onReviewJob(primaryJob.id)
      return
    }
    if (primaryJob.status === 'completed' && onViewResult) {
      onViewResult(primaryJob.id)
      return
    }
    setOpen(true)
  }

  const primaryActionLabel = primaryJob
    ? primaryJob.status === 'awaiting-user'
      ? 'Review'
      : primaryJob.status === 'completed'
        ? 'View'
        : 'Details'
    : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.currentTarget.click()
            }
          }}
          className={cn(
            'group flex items-center gap-2 rounded-full border border-border/50 bg-card/80 px-2.5 py-1 text-left transition-colors hover:border-border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            !hasJobs && 'opacity-80 hover:opacity-100'
          )}
          title="VTO Job Center"
        >
          <div className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors',
            hasJobs && 'border-primary/30 bg-primary/10 text-primary'
          )}>
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 max-w-[180px]">
            <p className="text-[11px] font-medium text-foreground truncate">
              {primaryJob ? getPrimaryHeadline(primaryJob) : 'No active jobs'}
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {primaryJob ? (
                <>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {primaryRemaining ? `${primaryRemaining} left` : getPrimaryStatusLabel(primaryJob)}
                  </span>
                  {activeCount > 1 && (
                    <span className="text-[9px] text-muted-foreground/80">
                      +{activeCount - 1} more
                    </span>
                  )}
                </>
              ) : (
                <span>All caught up</span>
              )}
            </div>
            {primaryProgress !== null && (
              <div className="mt-1 h-1 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round(primaryProgress * 100)}%` }}
                />
              </div>
            )}
          </div>
          {primaryActionLabel && (
            <button
              type="button"
              className="ml-auto rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              onClick={(event) => {
                event.stopPropagation()
                event.preventDefault()
                handlePrimaryAction()
              }}
            >
              {primaryActionLabel}
            </button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 shadow-lg"
        align="end"
        sideOffset={12}
        style={{ zIndex: 120, maxHeight: '70vh', overflow: 'hidden' }}
      >
        <div className="flex justify-end p-2 pb-0">
          <button
            type="button"
            className="h-6 w-6 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => setOpen(false)}
            aria-label="Close job center"
          >
            ×
          </button>
        </div>
        <ScrollArea className="max-h-[70vh]">
          <div className="divide-y divide-border/60">
            {sortedJobs.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No active jobs right now.
              </div>
            )}
            {sortedJobs.map((job) => {
              const remaining = formatRemaining(job, now)
              return (
                <div
                  key={job.id}
                  className={cn(
                    'px-4 py-4 space-y-3 transition-colors',
                    job.status === 'completed' && 'bg-emerald-50 dark:bg-emerald-500/5'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium leading-none text-foreground flex items-center gap-2">
                        {job.status === 'completed' && (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                        {job.title}
                      </p>
                      {job.message && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {job.message}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
                        job.status === 'in-progress' && 'bg-primary/10 text-primary',
                        job.status === 'queued' && 'bg-muted text-muted-foreground',
                        job.status === 'awaiting-user' && 'bg-amber-100 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300',
                        job.status === 'completed' && 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300',
                        job.status === 'error' && 'bg-destructive/10 text-destructive'
                      )}
                    >
                      {job.status.replace('-', ' ')}
                    </span>
                  </div>

                  {job.stages && job.stages.length > 0 && (
                    <div className="space-y-2">
                      {job.stages.map((stage, index) => {
                        const state = computeStageState(job, index, now)
                        return (
                          <div key={stage.id} className="flex items-center gap-2 text-xs">
                            <span
                              className={cn(
                                'inline-flex h-2.5 w-2.5 rounded-full border border-border/70',
                                state === 'active' && 'bg-primary/80 border-primary/80 animate-pulse',
                                state === 'complete' && 'bg-primary border-primary'
                              )}
                            />
                            <span className={cn(
                              'leading-none text-muted-foreground',
                              state !== 'pending' && 'text-foreground'
                            )}>
                              {stage.label}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {remaining && job.status === 'in-progress' && (
                    <p className="text-xs text-muted-foreground">Approx. {remaining} remaining</p>
                  )}

                  {job.status === 'awaiting-user' && onReviewJob && (
                    <Button size="sm" className="w-full" onClick={() => onReviewJob(job.id)}>
                      Review Candidates
                    </Button>
                  )}

                  {job.status === 'completed' && onViewResult && (
                    <Button size="sm" className="w-full" onClick={() => onViewResult(job.id)}>
                      View in Collections
                    </Button>
                  )}

                  {job.status === 'queued' && onCancelJob && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full text-muted-foreground"
                      onClick={() => onCancelJob(job.id)}
                    >
                      Cancel Job
                    </Button>
                  )}

                  {job.error && (
                    <p className="text-xs text-destructive">{job.error}</p>
                  )}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
