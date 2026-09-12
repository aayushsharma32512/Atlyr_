import { formatDistanceToNowStrict } from "date-fns"

import { Icons } from "@/design-system/icons"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { useJobs, type Job } from "@/features/progress/providers/JobsContext"
import {
  jobProgress,
  jobSubtitle,
  jobTitle,
  selectActiveJobs,
  selectFinishedJobs,
  TYPE_ICON,
  TYPE_LABEL,
} from "@/features/progress/notificationCopy"
import { useOpenJobResult } from "@/features/progress/openJobResult"
import { useRetryJob } from "@/features/progress/retryJob"
import { cn } from "@/lib/utils"

export function NotificationsScreen() {
  const { jobs, removeJob } = useJobs()
  const active = selectActiveJobs(jobs)
  const finished = selectFinishedJobs(jobs)
  const openResult = useOpenJobResult()
  const retryJob = useRetryJob()

  const isEmpty = active.length === 0 && finished.length === 0

  return (
    <AppShellLayout>
      <div className="flex min-h-full flex-col bg-background">
        <header className="flex h-control-header-title shrink-0 items-center px-4">
          <h1 className="font-display text-title font-medium text-ink">Notifications</h1>
        </header>

        {isEmpty ? (
          <div className="flex flex-1 items-center px-4 pb-16">
            <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-dashed border-hairline-dashed bg-card/45 px-5 py-10 text-center">
              <Icons.navNotifications className="h-5 w-5 text-taupe" aria-hidden="true" />
              <p className="max-w-[250px] font-display text-moment text-ink">Nothing cooking.</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-4 pb-6 pt-1">
            {active.length > 0 && (
              <Section label="In progress">
                {active.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </Section>
            )}
            {finished.length > 0 && (
              <Section label="Done">
                {finished.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onOpen={job.status === "ready" ? () => openResult(job) : undefined}
                    onRetry={job.status === "failed" ? () => retryJob(job) : undefined}
                    onDismiss={() => removeJob(job.id)}
                  />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>
    </AppShellLayout>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-section font-semibold uppercase tracking-[0.14em] text-taupe">{label}</h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

// One card per job. A running job shows its bar and what it is doing right now;
// a finished one says what tapping does. Dismiss only exists once the work is over.
function JobCard({
  job,
  onOpen,
  onRetry,
  onDismiss,
}: {
  job: Job
  onOpen?: () => void
  onRetry?: () => void
  onDismiss?: () => void
}) {
  const failed = job.status === "failed"
  const processing = job.status === "processing"
  const progress = jobProgress(job)
  const Icon = TYPE_ICON[job.type] ?? Icons.navStudio
  const Wrapper = onOpen ? "button" : "div"

  return (
    <li>
      <Wrapper
        type={onOpen ? "button" : undefined}
        onClick={onOpen}
        className={cn(
          "relative flex w-full items-stretch gap-3 rounded-lg border bg-card p-3 text-left",
          failed ? "border-destructive/30" : "border-hairline",
          onOpen && "active:bg-muted/40",
        )}
      >
        <Thumb job={job} />

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 py-0.5">
          <div className={cn("min-w-0", onDismiss && "pr-6")}>
            <p className="truncate text-card font-semibold text-ink">{jobTitle(job)}</p>
            <p className="mt-0.5 flex items-center gap-1 text-chip text-taupe">
              <Icon className={cn("h-3 w-3 shrink-0", processing && "animate-pulse")} aria-hidden="true" />
              <span>{TYPE_LABEL[job.type] ?? "Job"}</span>
              <span aria-hidden="true">&middot;</span>
              <span>{formatDistanceToNowStrict(job.startedAt, { addSuffix: true })}</span>
            </p>
          </div>

          {processing ? (
            <div className="flex flex-col gap-1">
              <div
                className="h-1 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div
                  className="h-full rounded-full bg-terracotta transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.max(progress, 4)}%` }}
                />
              </div>
              <p className="flex items-baseline justify-between text-chip text-taupe">
                <span className="truncate">{jobSubtitle(job)}</span>
                <span className="shrink-0 tabular-nums">{progress}%</span>
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className={cn("truncate text-chip", failed ? "text-destructive" : "text-taupe")}>
                {jobSubtitle(job)}
              </p>
              {onRetry ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRetry()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onRetry()
                    }
                  }}
                  className="flex h-control-chip shrink-0 items-center rounded-control border border-hairline bg-card px-3 text-chip font-medium text-ink"
                >
                  Retry
                </span>
              ) : onOpen ? (
                <Icons.carouselNext className="h-4 w-4 shrink-0 text-taupe" aria-hidden="true" />
              ) : null}
            </div>
          )}
        </div>

        {onDismiss && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Dismiss"
            onClick={(event) => {
              event.stopPropagation()
              onDismiss()
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                event.stopPropagation()
                onDismiss()
              }
            }}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-control text-taupe hover:text-ink"
          >
            <Icons.close className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </Wrapper>
    </li>
  )
}

function Thumb({ job }: { job: Job }) {
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-frame bg-muted">
      {job.thumbnail ? (
        <img src={job.thumbnail} alt="" className="h-full w-full object-cover" />
      ) : job.status === "processing" ? (
        <div className="h-full w-full animate-pulse bg-muted" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="font-deva text-chip font-medium text-ink/60">कलागृह</span>
        </div>
      )}
    </div>
  )
}
