import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { openLikenessDrawer } from "@/features/likeness/openLikenessDrawer"
import { supabase } from "@/integrations/supabase/client"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { getRememberedTryonComboKey, trackTryonGenerationCompleted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"

const STORAGE_KEY = "jobs_tracker_state"
const POLL_INTERVAL = 4000 // 4 seconds
const STALE_THRESHOLD = 30 * 60 * 1000 // 30 minutes
const TRYON_STUCK_THRESHOLD = 2 * 60 * 1000 // 2 minutes - match try-on backend cleanup
const LIKENESS_STUCK_THRESHOLD = 5 * 60 * 1000 // 5 minutes - likeness can take longer
const MAX_COMPLETED_JOBS = 5 // Keep only last 5 completed jobs in storage

type JobType = "likeness" | "tryon"
type JobStatus = "processing" | "ready" | "failed"

export type Job = {
  id: string
  type: JobType
  status: JobStatus
  startedAt: number
  progress?: number // 0-100 for real progress tracking
  thumbnail?: string
  metadata?: {
    batchId?: string
    generationId?: string
    expectedCount?: number // For likeness: number of candidates expected
    [key: string]: unknown
  }
}

type JobsState = {
  jobs: Job[]
  addJob: (job: Omit<Job, "startedAt">) => void
  updateJob: (id: string, updates: Partial<Job>) => void
  removeJob: (id: string) => void
  clearCompleted: () => void
  getJobById: (id: string) => Job | undefined
  processingCount: number
  readyCount: number
}

const JobsContext = createContext<JobsState | undefined>(undefined)

// Load jobs from localStorage with stale check
function loadJobsFromStorage(): Job[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []

    const jobs: Job[] = JSON.parse(stored)
    const now = Date.now()

    // Filter out stale/old jobs and clean up temp jobs
    const validJobs = jobs.filter((job) => {
      // Remove jobs older than 30 minutes
      if (now - job.startedAt > STALE_THRESHOLD) return false
      // Remove temp jobs older than 5 minutes (never updated)
      if (job.id.startsWith('temp-') && now - job.startedAt > 5 * 60 * 1000) return false
      return true
    })
    
    // Keep only active + last 5 completed
    const activeJobs = validJobs.filter(j => j.status === 'processing')
    const completedJobs = validJobs
      .filter(j => j.status === 'ready' || j.status === 'failed')
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_COMPLETED_JOBS)
    
    return [...activeJobs, ...completedJobs]
  } catch (error) {
    console.error("[JobsContext] Failed to load from storage:", error)
    return []
  }
}

// Check if job is stuck in processing for too long
function isJobStuck(job: Job): boolean {
  if (job.status !== 'processing' || job.id.startsWith('temp-')) return false
  const threshold =
    job.type === "tryon" ? TRYON_STUCK_THRESHOLD : LIKENESS_STUCK_THRESHOLD
  return Date.now() - job.startedAt > threshold
}

// Save jobs to localStorage
function saveJobsToStorage(jobs: Job[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
  } catch (error) {
    console.error("[JobsContext] Failed to save to storage:", error)
  }
}

// Fetch likeness batch status
async function fetchLikenessBatchStatus(
  batchId: string,
  expectedCount: number = 2
): Promise<{ status: JobStatus; thumbnail?: string; progress?: number }> {
  try {
    const { data, error } = await supabase.functions.invoke("likeness-get-batch", {
      body: { batchId },
    })

    if (error) {
      console.error("[JobsContext] likeness-get-batch error:", error)
      return { status: "processing", progress: 0 }
    }

    const candidateCount = data?.candidates?.length ?? 0
    
    if (data?.status === "ok" && candidateCount > 0) {
      // Calculate real progress based on candidates ready
      const progress = Math.min(100, (candidateCount / expectedCount) * 100)
      
      return {
        status: candidateCount >= expectedCount ? "ready" : "processing",
        thumbnail: data.candidates[0]?.signedUrl,
        progress,
      }
    }

    return { status: "processing", progress: 0 }
  } catch (error) {
    console.error("[JobsContext] likeness fetch failed:", error)
    return { status: "failed", progress: 0 }
  }
}

// Fetch tryon generation status
async function fetchTryonStatus(
  generationId: string,
): Promise<{ status: JobStatus; thumbnail?: string; progress?: number; errorType?: string }> {
  try {
    const { data, error } = await supabase
      .from("user_generations")
      .select("id, status, storage_path")
      .eq("id", generationId)
      .single()

    if (error) {
      console.error("[JobsContext] tryon query error:", error)
      return { status: "processing", progress: 30 }
    }

    if (!data) {
      return { status: "failed", progress: 0, errorType: "missing_row" }
    }

    // Map database status to job status with progress
    const dbStatus = data.status?.toLowerCase()
    
    switch (dbStatus) {
      case "completed":
      case "ready":
        {
          let thumbnail: string | undefined
          if (data.storage_path) {
            // Extract the actual file path from URL if needed
            let filePath = data.storage_path

            // If storage_path is a full URL, extract just the path part
            if (filePath.includes("/storage/v1/object/")) {
              const match = filePath.match(/\/generations\/[^?]+/)
              if (match) {
                filePath = match[0].replace(/^\//, "") // Remove leading slash
              }
            }

            // Create a fresh signed URL from the "generations" bucket
            const { data: signedData, error: signedError } = await supabase.storage
              .from("generations")
              .createSignedUrl(filePath, 3600)

            if (signedError) {
              console.error("[JobsContext] Error creating signed URL:", signedError, {
                original: data.storage_path,
                extracted: filePath,
              })
            } else {
              thumbnail = signedData?.signedUrl
            }
          }
          return { status: "ready", thumbnail, progress: 100 }
        }
      
      case "failed":
      case "cancelled":
      case "error":
        return { status: "failed", progress: 0, errorType: dbStatus }
      
      case "queued":
      case "pending":
        return { status: "processing", progress: 20 }
      
      case "generating":
      case "processing":
        return { status: "processing", progress: 60 }
      
      default:
        // Unknown status - log it and treat as processing
        console.warn(`[JobsContext] Unknown tryon status: ${dbStatus}`)
        return { status: "processing", progress: 40, errorType: dbStatus ?? "unknown" }
    }
  } catch (error) {
    console.error("[JobsContext] tryon fetch failed:", error)
    return { status: "failed", progress: 0, errorType: "fetch_failed" }
  }
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const analytics = useEngagementAnalytics()
  const [jobs, setJobs] = useState<Job[]>(() => loadJobsFromStorage())
  const pollTimeoutRef = useRef<NodeJS.Timeout>()
  const notifiedJobsRef = useRef(new Set<string>())

  const emitTryonGenerationCompletedIfNeeded = useCallback(
    (job: Job, next: { status: JobStatus; errorType?: string }, forcedErrorType?: string): boolean => {
      if (job.type !== "tryon") return false
      if (job.metadata?.completionCaptured) return false

      const tryonRequestId = (job.metadata?.generationId as string | undefined) ?? job.id
      const comboKey =
        (typeof job.metadata?.comboKey === "string" ? job.metadata.comboKey : null) ??
        getRememberedTryonComboKey(tryonRequestId)
      if (!comboKey) return false

      const startMs =
        typeof job.metadata?.generationStartedAtMs === "number" ? job.metadata.generationStartedAtMs : job.startedAt
      const durationMs = Math.max(0, Date.now() - startMs)
      const success = next.status === "ready"

      trackTryonGenerationCompleted(analytics, {
        tryon_request_id: tryonRequestId,
        combo_key: comboKey,
        success,
        duration_ms: durationMs,
        ...(success ? {} : { error_type: forcedErrorType ?? next.errorType ?? "failed" }),
      })
      return true
    },
    [analytics],
  )

  // Save to localStorage whenever jobs change
  useEffect(() => {
    saveJobsToStorage(jobs)
  }, [jobs])

  // Add a new job
  const addJob = useCallback((job: Omit<Job, "startedAt">) => {
    const newJob: Job = {
      ...job,
      startedAt: Date.now(),
    }

    console.log("[JobsContext] Adding job:", newJob)

    setJobs((prev) => {
      // Prevent duplicates
      if (prev.some((j) => j.id === newJob.id)) {
        console.log("[JobsContext] Job already exists:", newJob.id)
        return prev
      }
      
      const updated = [...prev, newJob]
      console.log("[JobsContext] Updated jobs:", updated)
      return updated
    })
  }, [])

  // Update an existing job
  const updateJob = useCallback((id: string, updates: Partial<Job>) => {
    setJobs((prev) => {
      // If updating the ID, we need to replace the job entirely
      if (updates.id && updates.id !== id) {
        return prev.map((job) => 
          job.id === id ? { ...job, ...updates, id: updates.id } : job
        )
      }
      // Regular update
      return prev.map((job) => (job.id === id ? { ...job, ...updates } : job))
    })
  }, [])

  // Remove a job
  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((job) => job.id !== id))
    notifiedJobsRef.current.delete(id)
  }, [])

  // Clear all completed/failed jobs
  const clearCompleted = useCallback(() => {
    setJobs((prev) => prev.filter((job) => job.status === "processing"))
    // Clear notified set for removed jobs
    const processingIds = new Set(
      jobs.filter((j) => j.status === "processing").map((j) => j.id),
    )
    notifiedJobsRef.current = new Set(
      Array.from(notifiedJobsRef.current).filter((id) => processingIds.has(id)),
    )
  }, [jobs])

  // Get job by ID
  const getJobById = useCallback(
    (id: string) => jobs.find((job) => job.id === id),
    [jobs],
  )

  // Poll for status updates
  const pollJobStatuses = useCallback(async () => {
    // First, check for stuck jobs and mark them as failed
    const stuckJobs = jobs.filter(isJobStuck)
    if (stuckJobs.length > 0) {
      console.warn('[JobsContext] Marking stuck jobs as failed:', stuckJobs.map(j => j.id))
      const emittedIds = new Set<string>()
      stuckJobs.forEach((job) => {
        const errorType = job.type === "tryon" ? "timeout_2m" : "timeout_5m"
        const emitted = emitTryonGenerationCompletedIfNeeded(
          job,
          { status: "failed", errorType },
          errorType,
        )
        if (emitted) emittedIds.add(job.id)
      })
      setJobs((prev) =>
        prev.map((j) =>
          isJobStuck(j)
            ? {
                ...j,
                status: "failed" as JobStatus,
                progress: 0,
                metadata: {
                  ...(j.metadata ?? {}),
                  errorType: j.type === "tryon" ? "timeout_2m" : "timeout_5m",
                  ...(emittedIds.has(j.id) ? { completionCaptured: true } : {}),
                },
              }
            : j
        )
      )
      return // Don't poll stuck jobs
    }
    
    const processingJobs = jobs.filter((job) => job.status === "processing")

    if (processingJobs.length === 0) {
      return
    }

    const updates = await Promise.allSettled(
      processingJobs.map(async (job) => {
        // Skip polling for temporary jobs (they'll be replaced with real IDs)
        if (job.id.startsWith('temp-')) {
          return null
        }
        
        let result: { status: JobStatus; thumbnail?: string; progress?: number; errorType?: string }

        if (job.type === "likeness" && job.metadata?.batchId) {
          const expectedCount = job.metadata.expectedCount ?? 2
          result = await fetchLikenessBatchStatus(job.metadata.batchId, expectedCount)
        } else if (job.type === "tryon" && job.metadata?.generationId) {
          result = await fetchTryonStatus(job.metadata.generationId)
        } else {
          return null
        }

        return { jobId: job.id, ...result }
      }),
    )

    // Apply updates and trigger notifications
    updates.forEach((settled) => {
      if (settled.status === "fulfilled" && settled.value) {
        const { jobId, status, thumbnail, progress, errorType } = settled.value
        const job = jobs.find((j) => j.id === jobId)

        if (!job) return

        // Check if status changed to ready
        const wasProcessing = job.status === "processing"
        const isNowReady = status === "ready"
        const isNowTerminal = status === "ready" || status === "failed"

        const didEmitCompletion = wasProcessing && isNowTerminal
          ? emitTryonGenerationCompletedIfNeeded(job, { status, errorType })
          : false

        if (wasProcessing && isNowReady && !notifiedJobsRef.current.has(jobId)) {
          // Trigger toast notification with action to invalidate queries
          const message =
            job.type === "likeness"
              ? "Your likeness is ready"
              : "Your outfit is ready"

          toast.success(message, {
            duration: 5000,
            action: {
              label: "View",
              onClick: () => {
                // Invalidate queries to refresh moodboard data
                queryClient.invalidateQueries({ queryKey: ["tryon"] })
                queryClient.invalidateQueries({ queryKey: ["generations"] })
                queryClient.invalidateQueries({ queryKey: ["user-generations"] })
                
                // Navigate only when user clicks "View"
                if (job.type === "tryon") {
                  window.location.href = "/home?moodboard=try-ons"
                } else if (job.type === "likeness" && job.metadata?.batchId) {
                  const outfitParams = job.metadata.outfitParams as Record<string, string | null> | undefined
                  const outfitItems = outfitParams
                    ? {
                        topId: outfitParams.topId ?? null,
                        bottomId: outfitParams.bottomId ?? null,
                        footwearId: outfitParams.footwearId ?? null,
                      }
                    : undefined
                  const resolvedGender =
                    outfitParams?.outfitGender === "male" ||
                    outfitParams?.outfitGender === "female" ||
                    outfitParams?.outfitGender === "unisex"
                      ? (outfitParams.outfitGender as "male" | "female" | "unisex")
                      : null
                  const outfitSnapshot = outfitParams
                    ? {
                        id: outfitParams.outfitId ?? undefined,
                        name: outfitParams.outfitName ?? null,
                        category: outfitParams.outfitCategory ?? null,
                        occasionId: outfitParams.outfitOccasion ?? null,
                        backgroundId: outfitParams.outfitBackgroundId ?? null,
                        gender: resolvedGender,
                      }
                    : undefined

	                  if (job.metadata?.saved) {
	                    const savedPoseId =
	                      typeof job.metadata?.savedPoseId === "string" ? job.metadata.savedPoseId : null
	                    openLikenessDrawer({
	                      initialStep: 3,
	                      batchId: job.metadata.batchId,
	                      outfitItems,
	                      outfitSnapshot,
	                      entrySource: "fromProgressHub",
	                      savedMode: true,
	                      savedPoseId,
	                    })
	                  } else {
                    openLikenessDrawer({
                      initialStep: 2,
                      batchId: job.metadata.batchId,
                      outfitItems,
                      outfitSnapshot,
                      entrySource: "fromProgressHub",
                    })
                  }
                }
              },
            },
          })

          notifiedJobsRef.current.add(jobId)
        }

        // Update job only if something changed
        const hasStatusChanged = job.status !== status
        const hasProgressChanged = job.progress !== progress
        const hasThumbnailChanged = job.thumbnail !== thumbnail
        
        if (hasStatusChanged || hasProgressChanged || hasThumbnailChanged) {
          console.log("[JobsContext] Updating job:", {
            jobId,
            type: job.type,
            oldStatus: job.status,
            newStatus: status,
            oldThumbnail: job.thumbnail,
            newThumbnail: thumbnail,
            progress
          })
          
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? {
                    ...j,
                    status,
                    ...(thumbnail && { thumbnail }),
                    ...(progress !== undefined && { progress }),
                    ...(j.type === "tryon" && didEmitCompletion ? { metadata: { ...(j.metadata ?? {}), completionCaptured: true } } : {}),
                  }
                : j,
            ),
          )
        }
      }
    })
  }, [emitTryonGenerationCompletedIfNeeded, jobs, queryClient])

  // Setup polling effect
  useEffect(() => {
    const processingCount = jobs.filter((job) => job.status === "processing").length

    if (processingCount > 0) {
      // Start polling
      const poll = async () => {
        await pollJobStatuses()
        pollTimeoutRef.current = setTimeout(poll, POLL_INTERVAL)
      }

      poll()

      return () => {
        if (pollTimeoutRef.current) {
          clearTimeout(pollTimeoutRef.current)
        }
      }
    }

    return undefined
  }, [jobs, pollJobStatuses])

  // Compute counts
  const processingCount = jobs.filter((job) => job.status === "processing").length
  const readyCount = jobs.filter((job) => job.status === "ready").length

  // Persist to localStorage with cleanup (only active + last 5 completed)
  useEffect(() => {
    const activeJobs = jobs.filter(j => j.status === 'processing')
    const completedJobs = jobs
      .filter(j => j.status === 'ready' || j.status === 'failed')
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_COMPLETED_JOBS)
    
    const jobsToStore = [...activeJobs, ...completedJobs]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobsToStore))
  }, [jobs])

  const value: JobsState = {
    jobs,
    addJob,
    updateJob,
    removeJob,
    clearCompleted,
    getJobById,
    processingCount,
    readyCount,
  }

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}

export function useJobs() {
  const context = useContext(JobsContext)
  if (!context) {
    throw new Error("useJobs must be used within a JobsProvider")
  }
  return context
}
