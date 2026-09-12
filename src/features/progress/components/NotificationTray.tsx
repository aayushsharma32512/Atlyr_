import { Bell, Sparkles } from "lucide-react"
import { formatDistanceToNowStrict } from "date-fns"

import { useJobs, type Job } from "../providers/JobsContext"
import { READY_TITLE, TYPE_ICON, TYPE_LABEL, selectFinishedJobs } from "../notificationCopy"
import { cn } from "@/lib/utils"

/**
 * Canvas 6p — the notification pop-out anchored under the bell.
 *
 * Scope note, deliberate: the canvas also draws label-news rows ("Nishorama
 * added 6 pieces · in a label you follow"). There is no follows table, no label
 * activity feed, and no endpoint to read one — so those rows would be invented
 * copy over invented data. The tray ships with the half that is real: finished
 * background work, straight from JobsContext. Adding label news later is a new
 * row type in this list, not a rewrite.
 *
 * Read state is local. It answers "have I seen this since the tray opened",
 * which needs no server round-trip and no schema — and a per-device read marker
 * is honest about what it knows.
 */

export interface NotificationTrayProps {
  open: boolean
  /** Ids already marked read — held by the caller so it survives close/open. */
  readIds: Set<string>
  onMarkAllRead: () => void
  onSelect: (job: Job) => void
  className?: string
}

export function NotificationTray({
  open,
  readIds,
  onMarkAllRead,
  onSelect,
  className,
}: NotificationTrayProps) {
  const { jobs } = useJobs()

  if (!open) return null

  const entries = selectFinishedJobs(jobs, 12)

  return (
    <div
      className={cn(
        "w-[260px] overflow-hidden rounded-[6px] border border-hairline bg-card shadow-floating",
        className,
      )}
      role="dialog"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <span className="text-[7.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Notifications
        </span>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={entries.length === 0}
          className="text-[8.5px] font-semibold text-ink-body disabled:opacity-40"
        >
          Mark all read
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-7 text-center">
          <Bell className="size-4 text-taupe" aria-hidden="true" />
          <p className="text-[9.5px] font-semibold text-foreground">Nothing new</p>
          <p className="text-[8px] text-muted-foreground">
            Finished try-ons and cut-outs land here.
          </p>
        </div>
      ) : (
        <ul className="max-h-[280px] divide-y divide-hairline overflow-y-auto">
          {entries.map((job) => {
            const isUnread = !readIds.has(job.id)
            const failed = job.status === "failed"
            const Icon = TYPE_ICON[job.type] ?? Sparkles

            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => onSelect(job)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors",
                    // Unread sits on a warm tint rather than carrying a dot —
                    // the whole row is the affordance, so the whole row reads.
                    isUnread ? "bg-terracotta/[0.07] hover:bg-terracotta/10" : "hover:bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-[1px] flex size-4 shrink-0 items-center justify-center rounded-full",
                      failed ? "text-destructive" : isUnread ? "text-terracotta" : "text-taupe",
                    )}
                  >
                    <Icon className="size-3" aria-hidden="true" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[9.5px] font-semibold text-foreground">
                        {failed
                          ? `${TYPE_LABEL[job.type] ?? "Job"} failed`
                          : READY_TITLE[job.type] ?? "Ready"}
                      </span>
                      <span className="shrink-0 text-[7.5px] text-muted-foreground">
                        {formatDistanceToNowStrict(job.startedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[8px] text-muted-foreground">
                      {failed ? "Tap to retry from the hub" : "Tap to reveal"}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
