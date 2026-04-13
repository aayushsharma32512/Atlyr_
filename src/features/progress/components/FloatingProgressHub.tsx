import { useState, useEffect, useRef, useCallback } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { CheckCircle2, X, Layers } from "lucide-react"
import { toast as sonnerToast } from "sonner"
import { useJobs } from "../providers/JobsContext"
import type { Job } from "../providers/JobsContext"
import { formatDistanceToNow } from "date-fns"
import { openLikenessDrawer } from "@/features/likeness/openLikenessDrawer"
import { generateTryOn, type TryOnGeneratePayload } from "@/services/tryon/tryonService"
import { tryOnKeys } from "@/features/tryon/queryKeys"
import { likenessKeys } from "@/features/likeness/queryKeys"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackTryonGenerationStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"

export function FloatingProgressHub() {
  const { jobs, processingCount, readyCount, removeJob, addJob, updateJob } = useJobs()
  const [isExpanded, setIsExpanded] = useState(false)
  const [yPosition, setYPosition] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight / 2 - 36 : 0
  ) // Y position in pixels
  const [isDragging, setIsDragging] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const analytics = useEngagementAnalytics()
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartYRef = useRef(0)
  const pointerStartYRef = useRef(0)
  const dragDistanceRef = useRef(0)
  const isDraggingRef = useRef(false)
  const lastExpandTimeRef = useRef(0)
  const activeDragHandlers = useRef<{
    move?: (event: PointerEvent) => void
    up?: (event: PointerEvent) => void
  }>({})

  const getOutfitContext = useCallback((job: Job) => {
    const outfitParams = job.metadata?.outfitParams as Record<string, string | null> | undefined
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
    return { outfitItems, outfitSnapshot }
  }, [])

  // Split and sort jobs: active first (newest), then completed (newest)
  const activeJobs = jobs
    .filter(j => j.status === 'processing')
    .sort((a, b) => b.startedAt - a.startedAt)

  const completedJobs = jobs
    .filter(j => j.status === 'ready' || j.status === 'failed')
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 5)

  // Click outside to collapse
  useEffect(() => {
    if (!isExpanded) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExpanded])

  // Handle window resize - keep position within bounds
  useEffect(() => {
    const handleResize = () => {
      const nextMinY = VIEW_PADDING
      const nextMaxY = Math.max(VIEW_PADDING, window.innerHeight - PILL_HEIGHT - VIEW_PADDING)
      setYPosition((prev) => Math.min(nextMaxY, Math.max(nextMinY, prev)))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleViewResult = (job: (typeof jobs)[0]) => {
    if (job.type === "likeness" && job.metadata?.batchId) {
      const { outfitItems, outfitSnapshot } = getOutfitContext(job)

      if (job.metadata?.saved) {
        const savedPoseId = typeof job.metadata?.savedPoseId === "string" ? job.metadata.savedPoseId : null
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
    } else if (job.type === "tryon") {
      navigate("/home?moodboard=try-ons")
    }
    setIsExpanded(false)
  }

  const handleRetry = useCallback(
    async (job: Job) => {
      if (job.status !== "failed") return

      if (job.type === "tryon") {
        const payload = job.metadata?.tryonPayload as TryOnGeneratePayload | undefined
        if (!payload?.neutralPoseId) {
          sonnerToast.error("Retry unavailable", {
            description: "Missing try-on details for retry.",
          })
          return
        }

        const comboKey = typeof job.metadata?.comboKey === "string" ? job.metadata.comboKey : null
        const tempId = `temp-tryon-${Date.now()}`
        const baseMetadata = { generationId: tempId, comboKey, tryonPayload: payload }

        addJob({
          id: tempId,
          type: "tryon",
          status: "processing",
          progress: 0,
          metadata: baseMetadata,
        })
        removeJob(job.id)

        sonnerToast.info("Retrying try-on", {
          description: "We'll notify you when it's ready.",
          duration: 4000,
        })

        try {
          const response = await generateTryOn(payload)
          const startedAt = Date.now()

          if (comboKey) {
            trackTryonGenerationStarted(analytics, {
              tryon_request_id: response.generationId,
              combo_key: comboKey,
            })
          }

          updateJob(tempId, {
            id: response.generationId,
            progress: 30,
            metadata: {
              ...baseMetadata,
              generationId: response.generationId,
              generationStartedAtMs: startedAt,
            },
          })

          queryClient.invalidateQueries({ queryKey: tryOnKeys.list() })
          queryClient.invalidateQueries({ queryKey: tryOnKeys.generation(response.generationId) })
          queryClient.invalidateQueries({ queryKey: likenessKeys.list() })
          queryClient.invalidateQueries({ queryKey: ["daily-limits"] })
        } catch (error) {
          updateJob(tempId, {
            status: "failed",
            progress: 0,
            metadata: {
              ...baseMetadata,
              errorType: "retry_failed",
            },
          })
          sonnerToast.error("Retry failed", {
            description: error instanceof Error ? error.message : "Unable to retry try-on.",
          })
        }
        return
      }

      if (job.type === "likeness") {
        const { outfitItems, outfitSnapshot } = getOutfitContext(job)
        removeJob(job.id)
        openLikenessDrawer({
          initialStep: 1,
          outfitItems,
          outfitSnapshot,
          entrySource: "fromProgressHub",
        })
        sonnerToast.info("Upload again to retry", {
          description: "We’ll regenerate your likeness once you submit.",
          duration: 4000,
        })
      }
    },
    [addJob, analytics, getOutfitContext, queryClient, removeJob, updateJob],
  )

  // Constants
  const PILL_HEIGHT = 40
  const EXPANDED_HEIGHT = 420
  const VIEW_PADDING = 12
  
  // Calculate bounds
  const minY = VIEW_PADDING
  const maxY = Math.max(VIEW_PADDING, window.innerHeight - PILL_HEIGHT - VIEW_PADDING)
  
  // Clamp current position
  const clampedY = Math.min(maxY, Math.max(minY, yPosition))
  const clampToViewport = useCallback(
    (value: number) => Math.min(maxY, Math.max(minY, value)),
    [maxY, minY]
  )
  
  // Decide expansion direction without moving the pill itself
  const expandUpward = (() => {
    const spaceAbove = clampedY - VIEW_PADDING
    const spaceBelow = (window.innerHeight - VIEW_PADDING) - (clampedY + PILL_HEIGHT)
    // If we're close to the bottom (not enough room below), expand upward
    return spaceBelow < EXPANDED_HEIGHT - PILL_HEIGHT && spaceAbove > spaceBelow
  })()
  const panelOffset = expandUpward ? "auto" : 0

  const cleanupDragListeners = () => {
    const { move, up } = activeDragHandlers.current
    if (move) {
      window.removeEventListener("pointermove", move)
    }
    if (up) {
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
    activeDragHandlers.current = {}
  }

  // Pointer-based drag for crisp, momentum-free movement
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isExpanded) return
    event.preventDefault()
    cleanupDragListeners()

    dragStartYRef.current = yPosition
    pointerStartYRef.current = event.clientY
    dragDistanceRef.current = 0
    isDraggingRef.current = true
    setIsDragging(true)

    const handleMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return
      const delta = moveEvent.clientY - pointerStartYRef.current
      dragDistanceRef.current = Math.abs(delta)
      setYPosition(clampToViewport(dragStartYRef.current + delta))
    }

    const handleUp = () => {
      if (!isDraggingRef.current) return
      const travelled = dragDistanceRef.current
      isDraggingRef.current = false
      setIsDragging(false)
      cleanupDragListeners()
      // Treat a tiny move as a tap to toggle expansion
      if (travelled < 6) {
        setIsExpanded((v) => {
          const next = !v
          if (next) {
            lastExpandTimeRef.current = Date.now()
          }
          return next
        })
      }
    }

    activeDragHandlers.current = { move: handleMove, up: handleUp }
    window.addEventListener("pointermove", handleMove, { passive: true })
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  useEffect(() => {
    return () => {
      cleanupDragListeners()
      isDraggingRef.current = false
    }
  }, [])

  const collapsedBadge =
    processingCount > 0 ? (
      <div className="relative h-6 w-6">
        <div className="absolute inset-0 rounded-full border-[1.5px] border-primary/25 border-t-primary animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-primary">
          {processingCount > 9 ? "9+" : processingCount}
        </div>
      </div>
    ) : readyCount > 0 ? (
      <div className="flex flex-col items-center justify-center">
        <div className="relative h-6 w-6">
          <div className="absolute inset-0 rounded-full border-[1.5px] border-primary/35 bg-primary/10" />
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-primary">
            {readyCount > 9 ? "9+" : readyCount}
          </div>
        </div>
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center">
        <span className="text-[12px] font-semibold tracking-normal text-foreground/90">Atlyr</span>
      </div>
    )

  return (
    <motion.div
      ref={containerRef}
      className="fixed left-0 z-[60] will-change-transform"
      initial={{ x: -120, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      style={{ top: clampedY }}
    >
      <motion.div
        onPointerDown={handlePointerDown}
        className="group relative overflow-visible cursor-pointer will-change-transform bg-card border border-border/50 shadow-floating"
        style={{
          touchAction: "none",
          userSelect: isDragging ? "none" : undefined,
        }}
        animate={{
          width: isExpanded ? 280 : 44,
          height: PILL_HEIGHT,
          maxHeight: isExpanded ? EXPANDED_HEIGHT : PILL_HEIGHT,
          borderTopLeftRadius: isExpanded ? 16 : 0,
          borderBottomLeftRadius: isExpanded ? 16 : 0,
          borderTopRightRadius: 16,
          borderBottomRightRadius: 16,
          x: isExpanded ? 12 : 0,
          scale: isExpanded ? 1.015 : 1,
        }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        data-dragging={isDragging}
        aria-label="Progress Hub"
        role="button"
        tabIndex={0}
      >
        {/* Collapsed summary strip */}
        {!isExpanded && (
          <div className="absolute inset-y-0 left-0 flex w-11 flex-col items-center justify-center gap-1">
            {!isExpanded && collapsedBadge}
          </div>
        )}

        {/* Expanded content */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="panel"
              initial={{
                opacity: 1,
                scaleY: 0.3,
                y: expandUpward ? 8 : -8,
              }}
              animate={{ opacity: 1, scaleY: 1, y: 0 }}
              exit={{
                opacity: 0,
                scaleY: 0.35,
                y: expandUpward ? 8 : -8,
              }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="h-full flex flex-col overflow-hidden rounded-2xl bg-card border border-border/50 shadow-floating"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                top: panelOffset,
                bottom: expandUpward ? 0 : "auto",
                left: 0,
                width: "100%",
                height: "auto",
                maxHeight: EXPANDED_HEIGHT,
                pointerEvents: "auto",
                transformOrigin: expandUpward ? "bottom center" : "top center",
              }}
            >
              <div className="flex w-full items-center justify-between px-3 pt-0.5 pb-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-normal text-foreground">Atlyr</span>
                </div>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-xl"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2 space-y-2">
                {jobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center gap-1">
                    <p className="text-sm font-medium text-foreground">No active generations</p>
                    <p className="text-xs text-muted-foreground">Start a Try-On in Studio!</p>
                  </div>
                ) : (
                  <>
                    {activeJobs.length > 0 && (
                      <>
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                          Active ({activeJobs.length})
                        </div>
                        <div className="overflow-hidden rounded-2xl border border-border/40 bg-background divide-y divide-border/30">
                          {activeJobs.map((job) => (
                            <JobCard
                              key={job.id}
                              job={job}
                              removeJob={removeJob}
                              handleViewResult={handleViewResult}
                              handleRetry={handleRetry}
                              shouldBlockClick={() => Date.now() - lastExpandTimeRef.current < 220}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {completedJobs.length > 0 && (
                      <>
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5 mt-3">
                          Recent ({completedJobs.length})
                        </div>
                        <div className="overflow-hidden rounded-2xl border border-border/40 bg-background divide-y divide-border/30">
                          {completedJobs.map((job) => (
                            <JobCard
                              key={job.id}
                              job={job}
                              removeJob={removeJob}
                              handleViewResult={handleViewResult}
                              handleRetry={handleRetry}
                              shouldBlockClick={() => Date.now() - lastExpandTimeRef.current < 220}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

// JobCard component for rendering individual job items
function JobCard({
  job,
  removeJob,
  handleViewResult,
  handleRetry,
  shouldBlockClick,
}: {
  job: Job
  removeJob: (id: string) => void
  handleViewResult: (job: Job) => void
  handleRetry: (job: Job) => void
  shouldBlockClick: () => boolean
}) {
  const isProcessing = job.status === "processing"
  return (
    <div 
      className={`flex items-start gap-3 p-2.5 ${
        job.status === "ready"
          ? "cursor-pointer"
          : job.status === "failed"
            ? "bg-destructive/5"
            : ""
      }`}
      onClick={() => {
        if (job.status === "ready" && !shouldBlockClick()) {
          handleViewResult(job)
        }
      }}
    >
      {/* Thumbnail on the left - bigger */}
      <div className="relative flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden bg-muted/50">
        {job.thumbnail ? (
          <img
            src={job.thumbnail}
            alt="Preview"
            className="w-full h-full object-cover"
            onError={(e) => {
              console.error("[FloatingProgressHub] Image load error:", {
                jobId: job.id,
                thumbnail: job.thumbnail,
                error: e
              })
            }}
          />
        ) : job.status === "processing" ? (
          <div className="h-full w-full animate-pulse bg-muted/60" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[10px] font-semibold tracking-normal text-foreground/60">Atlyr</span>
          </div>
        )}
      </div>

      {/* Content on the right */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Job Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground leading-none">
              {job.type === "likeness" ? "Likeness" : "Try-on"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1 leading-none">
              {formatDistanceToNow(job.startedAt, { addSuffix: true })}
            </p>
          </div>
          {!isProcessing && (
             <button
             onClick={(e) => {
              e.stopPropagation()
              removeJob(job.id)
            }}
             className="h-3 w-3 inline-flex items-center justify-center rounded-xl"
             aria-label="Close"
           >
             <X className="h-3 w-3" />
           </button>
          )}
        </div>

        {/* Real Progress Bar */}
        {job.status === "processing" && (
          <div className="relative w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
            <motion.div
              className="absolute inset-y-0 left-0 bg-primary rounded-full"
              animate={{ width: `${job.progress ?? 0}%` }}
              transition={{
                duration: 0.5,
                ease: "easeOut",
              }}
            />
          </div>
        )}

        {job.status === "failed" && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-destructive">
              Generation failed.
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleRetry(job)
              }}
              className="text-[10px] font-semibold text-primary"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
