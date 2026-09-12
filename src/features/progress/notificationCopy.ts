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
