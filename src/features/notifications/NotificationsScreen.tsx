import { useCallback, useMemo, useState, type ReactNode } from "react"
import { format, formatDistanceToNowStrict, isThisWeek, isToday } from "date-fns"

import { Icons } from "@/design-system/icons"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { useProductsByIds } from "@/features/collections/hooks/useMoodboards"
import { useJobs, type Job } from "@/features/progress/providers/JobsContext"
import { jobStage, jobTitle } from "@/features/progress/notificationCopy"
import { useOpenJobResult } from "@/features/progress/openJobResult"
import { useRetryJob } from "@/features/progress/retryJob"
import { cn } from "@/lib/utils"

import { useNotices, type Notice } from "./notices"

/**
 * V2 Notifications: 52px header with "mark all read", rows grouped by time
 * (today · earlier), each a 36px icon well + title + line + time, unread
 * marked by a violet tint on the well and a violet dot under the time.
 *
 * Two sources feed one list. Background jobs (try-on, likeness, find items)
 * come from JobsContext. Everything else — a piece saved, a curation that
 * appeared, the daily quota renewing — comes from the notices store, emitted
 * where those things happen. Read state is per device, in localStorage.
 */

const READ_KEY = "atlyr:notifications:readIds"

function loadReadIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(READ_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    // Private mode or blocked storage — start unread, which is the honest state.
    return new Set()
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(READ_KEY, JSON.stringify([...ids]))
  } catch {
    // Same: nothing to do if storage is unavailable.
  }
}

type IconComponent = React.ComponentType<{ className?: string }>

// Which glyph sits in the well, per job type.
const JOB_ICON: Record<Job["type"], IconComponent> = {
  tryon: Icons.studio,
  likeness: Icons.viewAvatar,
  import: Icons.findItems,
}

// And per notice kind.
const NOTICE_ICON: Record<Notice["kind"], IconComponent> = {
  save: Icons.save,
  curation: Icons.navCollections,
  quota: Icons.studio,
}

// The second line of a finished job, in the design's voice.
const READY_LINE: Record<Job["type"], string> = {
  tryon: "Open in Studio",
  likeness: "Ready to use in Studio",
  import: "Open to pick your pieces",
}

function jobLine(job: Job): string {
  if (job.status === "failed") return "Something went wrong — tap to retry"
  if (job.status === "processing") return jobStage(job)
  if (job.type === "import") {
    const matches = job.metadata?.matches as { top?: number; bottom?: number } | undefined
    if (matches && (matches.top || matches.bottom)) {
      return `${matches.top ?? 0} matches for the tops slot, ${matches.bottom ?? 0} for lowers`
    }
  }
  return READY_LINE[job.type] ?? "Ready"
}

/** "2m" / "1h" today, the weekday this week, else "1 Sep". */
function timeLabel(ms: number) {
  const date = new Date(ms)
  if (isToday(date)) {
    const distance = formatDistanceToNowStrict(date) // "2 minutes", "1 hour"
    const match = distance.match(/^(\d+)\s+(second|minute|hour|day)/)
    if (!match) return distance
    const unit = { second: "s", minute: "m", hour: "h", day: "d" }[match[2]] ?? ""
    return `${match[1]}${unit}`
  }
  if (isThisWeek(date)) return format(date, "EEE")
  return format(date, "d MMM")
}

/** One shape for both sources, so the list sorts and groups without caring which is which. */
type Row = {
  id: string
  title: string
  line: ReactNode
  at: number
  Icon: IconComponent
  processing: boolean
  failed: boolean
  onSelect?: () => void
}

/** A saved piece names itself lazily — the save only knew the product id. */
function SavedPieceLine({ productId, line }: { productId: string; line: string }) {
  const products = useProductsByIds([productId])
  const name = products.data?.[productId]?.product_name
  return <>{name ? `${name} ${line}` : `Piece ${line}`}</>
}

export function NotificationsScreen() {
  const { jobs } = useJobs()
  const notices = useNotices()
  const openResult = useOpenJobResult()
  const retryJob = useRetryJob()

  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds)

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      saveReadIds(next)
      return next
    })
  }, [])

  const handleJob = useCallback(
    (job: Job) => {
      markRead(job.id)
      if (job.status === "ready") openResult(job)
      else if (job.status === "failed") retryJob(job)
    },
    [markRead, openResult, retryJob],
  )

  const rows = useMemo<Row[]>(() => {
    const fromJobs: Row[] = jobs.map((job) => ({
      id: job.id,
      title: jobTitle(job),
      line: jobLine(job),
      at: job.startedAt,
      Icon: JOB_ICON[job.type] ?? Icons.studio,
      processing: job.status === "processing",
      failed: job.status === "failed",
      // A running row has nothing to open yet.
      onSelect: job.status === "processing" ? undefined : () => handleJob(job),
    }))
    const fromNotices: Row[] = notices.map((notice) => {
      const productId = typeof notice.payload?.productId === "string" ? notice.payload.productId : null
      return {
        id: notice.id,
        title: notice.title,
        line:
          notice.kind === "save" && productId ? (
            <SavedPieceLine productId={productId} line={notice.line} />
          ) : (
            notice.line
          ),
        at: notice.at,
        Icon: NOTICE_ICON[notice.kind],
        processing: false,
        failed: false,
        onSelect: () => markRead(notice.id),
      }
    })
    return [...fromJobs, ...fromNotices].sort((a, b) => b.at - a.at)
  }, [handleJob, jobs, markRead, notices])

  const today = useMemo(() => rows.filter((row) => isToday(new Date(row.at))), [rows])
  const earlier = useMemo(() => rows.filter((row) => !isToday(new Date(row.at))), [rows])

  // A running job is not news yet; only landed work can be unread.
  const isUnread = useCallback((row: Row) => !row.processing && !readIds.has(row.id), [readIds])
  const unreadCount = rows.filter(isUnread).length

  const markAllRead = useCallback(() => {
    const next = new Set(rows.map((row) => row.id))
    saveReadIds(next)
    setReadIds(next)
  }, [rows])

  const isEmpty = rows.length === 0

  return (
    <AppShellLayout>
      <div className="flex min-h-full flex-col bg-background">
        {/* The screen names itself here and nowhere else; the one action rides on the right. */}
        <header className="flex h-control-header-title shrink-0 items-center justify-between border-b border-hairline px-4">
          <h1 className="font-display text-title font-medium text-ink">Notifications</h1>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="text-chip font-medium text-ink transition-colors disabled:text-taupe"
          >
            mark all read
          </button>
        </header>

        {isEmpty ? (
          <div className="flex flex-1 items-center px-4 pb-16">
            <div className="flex w-full flex-col items-center gap-3 rounded-control border border-dashed border-hairline-dashed px-5 py-10 text-center">
              <Icons.navNotifications className="h-5 w-5 text-taupe" aria-hidden="true" />
              <p className="max-w-[250px] font-voice text-body italic text-charcoal">Nothing cooking.</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col px-4 pb-6">
            {today.length > 0 ? (
              <Group label="Today">
                {today.map((row) => (
                  <RowItem key={row.id} row={row} unread={isUnread(row)} />
                ))}
              </Group>
            ) : null}
            {earlier.length > 0 ? (
              <Group label="Earlier">
                {earlier.map((row) => (
                  <RowItem key={row.id} row={row} unread={isUnread(row)} />
                ))}
              </Group>
            ) : null}
          </div>
        )}
      </div>
    </AppShellLayout>
  )
}

// The group labels are the one place V2 keeps tracked caps: TODAY / EARLIER read
// as a date rule over the list, not as a section title.
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="pb-1 pt-4 text-section font-semibold uppercase tracking-[0.14em] text-taupe">{label}</h2>
      <ul className="divide-y divide-hairline">{children}</ul>
    </section>
  )
}

function RowItem({ row, unread }: { row: Row; unread: boolean }) {
  const { Icon } = row
  const actionable = Boolean(row.onSelect)

  return (
    <li>
      <button
        type="button"
        onClick={row.onSelect}
        disabled={!actionable}
        className="flex w-full items-start gap-3 py-3 text-left disabled:cursor-default"
      >
        {/* 36px well: violet tint while unread, plain ground once read. */}
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            unread ? "bg-violet-tint text-violet" : "bg-muted text-ink",
            row.failed && "text-destructive",
          )}
        >
          {row.processing ? (
            <span
              className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-taupe/40 border-t-ink"
              role="progressbar"
              aria-label="In progress"
              aria-busy="true"
            />
          ) : (
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-card font-medium text-ink">{row.title}</span>
          <span className={cn("line-clamp-2 text-chip", row.failed ? "text-destructive" : "text-taupe")}>
            {row.line}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
          <span className="text-chip text-taupe">{timeLabel(row.at)}</span>
          {unread ? <span aria-label="Unread" className="h-1.5 w-1.5 rounded-full bg-violet" /> : null}
        </span>
      </button>
    </li>
  )
}
