import { formatDistanceToNowStrict } from "date-fns"

import { Icons } from "@/design-system/icons"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { useJobs, type Job } from "@/features/progress/providers/JobsContext"
import {
  jobTitle,
  selectActiveJobs,
  selectFinishedJobs,
  TYPE_ICON,
} from "@/features/progress/notificationCopy"
import { useOpenJobResult } from "@/features/progress/openJobResult"
import { useRetryJob } from "@/features/progress/retryJob"
import { cn } from "@/lib/utils"

export function NotificationsScreen() {
  const { jobs } = useJobs()
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
          <ul className="divide-y divide-hairline border-t border-hairline">
            {active.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
            {finished.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onOpen={() => openResult(job)}
                onRetry={job.status === "failed" ? () => retryJob(job) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </AppShellLayout>
  )
}

function JobRow({
  job,
  onOpen,
  onRetry,
}: {
  job: Job
  onOpen?: () => void
  onRetry?: () => void
}) {
  const failed = job.status === "failed"
  const processing = job.status === "processing"
  const Icon = TYPE_ICON[job.type] ?? Icons.navStudio

  return (
    <li className="flex min-h-control-detail items-center gap-3 px-4 py-3">
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center",
          failed ? "text-destructive" : processing ? "text-taupe" : "text-ink",
        )}
      >
        <Icon className={cn("h-4 w-4", processing && "animate-pulse")} aria-hidden="true" />
      </span>

      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="min-w-0 flex-1 truncate text-left text-label font-semibold text-ink disabled:cursor-default"
      >
        {jobTitle(job)}
      </button>

      <span className="shrink-0 text-body text-taupe">
        {formatDistanceToNowStrict(job.startedAt)}
      </span>

      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="flex h-control-chip shrink-0 items-center rounded-control border border-hairline bg-card px-3 text-chip font-medium text-ink"
        >
          Retry
        </button>
      ) : onOpen ? (
        <Icons.carouselNext className="h-4 w-4 shrink-0 text-taupe" aria-hidden="true" />
      ) : null}
    </li>
  )
}
