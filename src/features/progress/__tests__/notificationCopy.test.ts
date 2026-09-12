import { describe, expect, it } from "bun:test"

import type { Job } from "../providers/JobsContext"
import { jobProgress, jobStage, jobSubtitle } from "../notificationCopy"

const base = { startedAt: Date.now() }

const job = (overrides: Partial<Job>): Job =>
  ({ id: "j1", type: "tryon", status: "processing", ...base, ...overrides }) as Job

describe("jobProgress", () => {
  it("clamps to 0..100 and defaults to 0", () => {
    expect(jobProgress(job({ progress: undefined }))).toBe(0)
    expect(jobProgress(job({ progress: -5 }))).toBe(0)
    expect(jobProgress(job({ progress: 140 }))).toBe(100)
    expect(jobProgress(job({ progress: 60 }))).toBe(60)
  })

  it("reads 100 for ready jobs regardless of stored progress", () => {
    expect(jobProgress(job({ status: "ready", progress: 30 }))).toBe(100)
  })
})

describe("jobStage", () => {
  it("names the try-on stages from the poller's progress steps", () => {
    expect(jobStage(job({ progress: 0 }))).toBe("Sending to the studio")
    expect(jobStage(job({ progress: 20 }))).toBe("In the queue")
    expect(jobStage(job({ progress: 60 }))).toBe("Dressing your likeness")
  })

  it("counts likeness candidates as they land", () => {
    const likeness = job({
      type: "likeness",
      progress: 50,
      metadata: { batchId: "b", expectedCount: 2 },
    })
    expect(jobStage(likeness)).toBe("1 of 2 looks ready")
    expect(jobStage(job({ type: "likeness", progress: 0 }))).toBe("Building your likeness")
  })

  it("is empty once the job is finished", () => {
    expect(jobStage(job({ status: "ready" }))).toBe("")
    expect(jobStage(job({ status: "failed" }))).toBe("")
  })
})

describe("jobSubtitle", () => {
  it("tells the user what tapping does", () => {
    expect(jobSubtitle(job({ status: "ready" }))).toBe("Tap to open")
    expect(jobSubtitle(job({ status: "failed" }))).toBe("Something went wrong. Retry when you're ready.")
    expect(jobSubtitle(job({ status: "processing", progress: 20 }))).toBe("In the queue")
  })
})
