import { useEffect, useRef, useState, type MouseEvent, type TouchEvent, type SyntheticEvent } from "react"
import { ArrowUpRight, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { IconButton } from "@/design-system/primitives"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { getRememberedTryonComboKey, trackTryonResultViewed } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"
import type { TryOn } from "@/services/collections/collectionsService"

type TryOnPreviewOverlayProps = {
  items: TryOn[]
  activeIndex: number
  onClose: () => void
  onIndexChange: (nextIndex: number) => void
  onOpenStudio: (item: TryOn) => void
}

export function TryOnPreviewOverlay({
  items,
  activeIndex,
  onClose,
  onIndexChange,
  onOpenStudio,
}: TryOnPreviewOverlayProps) {
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const lockAppliedRef = useRef<boolean>(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mouseStartRef = useRef<number | null>(null)
  const isDraggingRef = useRef<boolean>(false)
  const analytics = useEngagementAnalytics()
  const viewedTryOnIdsRef = useRef<Set<string>>(new Set())
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [imageMeta, setImageMeta] = useState<Record<string, { width: number; height: number }>>({})

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const element = containerRef.current
    const rect = element.getBoundingClientRect()
    setContainerSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }))
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setContainerSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const maxIndex = Math.max(0, items.length - 1)
  const activeItem = items[activeIndex]

  useEffect(() => {
    if (!activeItem?.id) return
    if (viewedTryOnIdsRef.current.has(activeItem.id)) return

    const comboKey = getRememberedTryonComboKey(activeItem.id)
    if (!comboKey) return

    viewedTryOnIdsRef.current.add(activeItem.id)
    trackTryonResultViewed(analytics, { tryon_request_id: activeItem.id, combo_key: comboKey })
  }, [activeItem?.id, analytics])

  const stepIndex = (delta: number) => {
    if (items.length <= 1) return
    const nextIndex = Math.min(maxIndex, Math.max(0, activeIndex + delta))
    if (nextIndex !== activeIndex) {
      onIndexChange(nextIndex)
    }
  }

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() }
    lockAppliedRef.current = false
    if (containerRef.current) {
      containerRef.current.style.touchAction = "pan-y"
    }
  }

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current
    if (!start) return
    const touch = event.touches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (!lockAppliedRef.current && Math.abs(dx) > Math.abs(dy) * 2.5) {
      if (containerRef.current) {
        containerRef.current.style.touchAction = "none"
      }
      lockAppliedRef.current = true
    }
  }

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (containerRef.current) {
      containerRef.current.style.touchAction = "pan-y"
    }
    lockAppliedRef.current = false
    if (!start) return

    // Avoid colliding with the OS back gesture.
    if (start.x <= 16) return

    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const dt = Date.now() - start.t
    const velocity = Math.abs(dx) / Math.max(1, dt)
    const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI)
    const horizontalEnough = angle <= 20
    const distanceCommit = Math.abs(dx) > 50
    const velocityCommit = velocity >= 0.6

    if (horizontalEnough && (distanceCommit || velocityCommit)) {
      if (dx < 0) {
        stepIndex(1)
      } else {
        stepIndex(-1)
      }
    }
  }

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    isDraggingRef.current = true
    mouseStartRef.current = event.clientX
  }

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || mouseStartRef.current === null) return
    const diff = event.clientX - mouseStartRef.current
    const threshold = 50
    if (Math.abs(diff) > threshold) {
      if (diff < 0) {
        stepIndex(1)
      } else {
        stepIndex(-1)
      }
    }
    isDraggingRef.current = false
    mouseStartRef.current = null
  }

  const handleImageLoad = (id: string) => (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (!naturalWidth || !naturalHeight) return
    setImageMeta((prev) => {
      const existing = prev[id]
      if (existing && existing.width === naturalWidth && existing.height === naturalHeight) {
        return prev
      }
      return { ...prev, [id]: { width: naturalWidth, height: naturalHeight } }
    })
  }

  const getImageOffsets = (id: string) => {
    const meta = imageMeta[id]
    if (!meta || !containerSize.width || !containerSize.height) return null
    const scale = Math.min(containerSize.width / meta.width, containerSize.height / meta.height)
    const renderedWidth = meta.width * scale
    const renderedHeight = meta.height * scale
    const offsetX = (containerSize.width - renderedWidth) / 2
    const offsetY = (containerSize.height - renderedHeight) / 2
    return { offsetX, offsetY }
  }

  if (!activeItem) {
    return null
  }

  const activeOffsets = activeItem.imageUrl ? getImageOffsets(activeItem.id) : null
  const fallbackBottomInset = "calc(env(safe-area-inset-bottom) + 16px)"
  const isCompactView = containerSize.width > 0 && containerSize.width < 768
  const overlayPosition = !isCompactView && activeOffsets
    ? { left: activeOffsets.offsetX + 12, right: activeOffsets.offsetX + 12, bottom: activeOffsets.offsetY + 12 }
    : { left: 16, right: 16, bottom: fallbackBottomInset }

  return (
    <div
      className="fixed inset-0 z-[150] bg-background"
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          isDraggingRef.current = false
          mouseStartRef.current = null
        }}
        style={{ touchAction: "pan-y" }}
      >
        <div
          className="flex h-full w-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {items.map((item, index) => {
            return (
              <div
                key={item.id}
                className="relative h-full w-full flex-shrink-0"
                onContextMenu={(event) => event.preventDefault()}
                style={{ WebkitTouchCallout: "none" }}
              >
                {item.imageUrl ? (
                  <>
                    <img
                      src={item.imageUrl}
                      alt="Try-on preview"
                      className="h-full w-full object-cover object-center select-none md:object-contain"
                      loading={index === activeIndex ? "eager" : "lazy"}
                      draggable={false}
                      onLoad={handleImageLoad(item.id)}
                    />
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                    Preview unavailable
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="relative flex items-center justify-center">
          <IconButton
            tone="ghost"
            size="sm"
            className="pointer-events-auto absolute left-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </IconButton>
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs2 font-semibold text-foreground">
            <span className="text-sm font-semibold">Looks</span>
            <span className="rounded-full bg-foreground/90 px-2 py-0.5 text-xs2 text-background">
              {activeIndex + 1}/{items.length}
            </span>
          </div>
        </div>
      </div>

      <div
        className="pointer-events-none absolute z-10"
        style={overlayPosition}
      >
        <div className="flex items-baseline justify-between">
          {activeItem.outfitId ? (
            <Button
              variant="secondary"
              className="pointer-events-auto h-10 rounded-full bg-transparent px-4 py-0.5 text-sm font-semibold shadow-none hover:bg-transparent"
              onClick={() => onOpenStudio(activeItem)}
            >
              Studio
              <ArrowUpRight className="ml-1 size-4" />
            </Button>
          ) : null}
          <div
            className="rounded-full px-2 py-0.5 text-[14px] font-semibold text-foreground"
            style={{ touchAction: "pan-y", WebkitTouchCallout: "none" }}
          >
            Atlyr
          </div>
        </div>
      </div>
    </div>
  )
}
