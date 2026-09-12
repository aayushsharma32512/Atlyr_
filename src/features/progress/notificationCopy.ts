import { CheckCircle2, Sparkles } from "lucide-react"

import type { Job } from "./providers/JobsContext"

// Two job types only — JobType is "likeness" | "tryon". Wardrobe work is not
// tracked as a job anywhere, so there is nothing to show for it yet.
export const TYPE_LABEL: Record<Job["type"], string> = {
  tryon: "Try-on",
  likeness: "Likeness",
}

export const TYPE_ICON: Record<Job["type"], React.ComponentType<{ className?: string }>> = {
  tryon: Sparkles,
  likeness: CheckCircle2,
}

export const READY_TITLE: Record<Job["type"], string> = {
  tryon: "Your look is ready",
  likeness: "Your likeness is saved",
}

// Names the work rather than counting it.
export const PROCESSING_TITLE: Record<Job["type"], string> = {
  tryon: "Dressing your likeness…",
  likeness: "Building your likeness…",
}

/** Finished work — ready or failed, newest first. */
export function selectFinishedJobs(jobs: Job[], limit?: number) {
  const done = jobs
    .filter((job) => job.status === "ready" || job.status === "failed")
    .sort((a, b) => b.startedAt - a.startedAt)

  return limit ? done.slice(0, limit) : done
}

/** Still running, newest first. */
export function selectActiveJobs(jobs: Job[]) {
  return jobs
    .filter((job) => job.status === "processing")
    .sort((a, b) => b.startedAt - a.startedAt)
}

export function jobTitle(job: Job) {
  if (job.status === "processing") return PROCESSING_TITLE[job.type] ?? "Working…"
  return job.status === "failed"
    ? `${TYPE_LABEL[job.type] ?? "Job"} failed`
    : READY_TITLE[job.type] ?? "Ready"
}

/** 0..100, always a number; a ready job reads full even if the poller never wrote 100. */
export function jobProgress(job: Job) {
  if (job.status === "ready") return 100
  const raw = typeof job.progress === "number" ? job.progress : 0
  return Math.min(100, Math.max(0, Math.round(raw)))
}

/**
 * What the job is doing right now. Mirrors the poller's coarse steps in
 * JobsContext (try-on: 20 queued → 60 generating; likeness: candidates / expected),
 * so the card says something truer than a lone percentage.
 */
export function jobStage(job: Job) {
  if (job.status !== "processing") return ""
  const progress = jobProgress(job)

  if (job.type === "likeness") {
    const expected =
      typeof job.metadata?.expectedCount === "number" && job.metadata.expectedCount > 0
        ? job.metadata.expectedCount
        : 2
    const landed = Math.floor((progress / 100) * expected)
    return landed > 0 ? `${landed} of ${expected} looks ready` : "Building your likeness"
  }

  if (progress >= 60) return "Dressing your likeness"
  if (progress >= 20) return "In the queue"
  return "Sending to the studio"
}

/** Second line of a notification card. */
export function jobSubtitle(job: Job) {
  if (job.status === "ready") return "Tap to open"
  if (job.status === "failed") return "Something went wrong. Retry when you're ready."
  return jobStage(job)
}
