import { Heart } from "lucide-react"

import type { CSSProperties } from "react"
import { useEffect, useMemo, useRef, useState } from "react"

import { AvatarRenderer } from "@/features/studio/components/AvatarRenderer"
import { useMannequinConfig } from "@/features/studio/hooks/useMannequinConfig"
import { useOutfitProducts } from "@/features/studio/hooks/useOutfitProducts"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useAvatarHairStyles } from "@/features/profile/hooks/useAvatarHairStyles"
import { IconButton } from "@/design-system/primitives/icon-button"
import { cn } from "@/lib/utils"
import type {
  OutfitInspirationVariant,
  StudioRenderedItem,
  StudioRenderedZone,
  MannequinSegmentName,
} from "@/features/studio/types"
import { computeOutfitVisibleSegments, studioRenderedItemToOutfitItem } from "@/features/studio/mappers/renderedItemMapper"

interface OutfitInspirationCardProps {
  renderedItems?: StudioRenderedItem[]
  outfitId?: string | null
  fallbackImageSrc?: string
  title?: string
  attribution?: string
  chips?: string[]
  variant?: OutfitInspirationVariant
  isSaved?: boolean
  showTitle?: boolean
  showChips?: boolean
  showSaveButton?: boolean
  onToggleSave?: () => void
  onLongPressSave?: () => void
  onItemSelect?: (item: ReturnType<typeof studioRenderedItemToOutfitItem>) => void
  className?: string
  avatarHeadSrc?: string
  avatarHeight?: number
  avatarGender?: "male" | "female"
  avatarHeightCm?: number
  sizeMode?: "fixed" | "fluid"
  aspectRatio?: string
  fluidHeight?: number
  fluidLayout?: "card" | "avatar"
  renderBox?: { width: number; height: number }
  onMetaHeightChange?: (height: number) => void
  disableAvatarSwipe?: boolean
  slotOrder?: StudioRenderedZone[]
  /** Zone that just changed - used for per-item animations */
  animatingZone?: StudioRenderedZone | null
  /** Callback when avatar is fully loaded */
  onAvatarReady?: (ready: boolean) => void
  allowEmptyMannequin?: boolean
  onSlotSelect?: (slot: "top" | "bottom" | "shoes") => void
  /** Ref to the avatar container for snapshot capture */
  avatarRef?: React.Ref<HTMLDivElement>
}

const variantConfig: Record<
  OutfitInspirationVariant,
  {
    containerWidth: string
    titleClamp: string
  }
> = {
  wide: {
    containerWidth: "w-24",
    titleClamp: "line-clamp-2",
  },
  narrow: {
    containerWidth: "w-24",
    titleClamp: "line-clamp-2",
  },
}

export function OutfitInspirationCard({
  renderedItems,
  outfitId,
  fallbackImageSrc,
  title,
  attribution = "",
  chips = [],
  variant = "narrow",
  isSaved = false,
  showTitle = true,
  showChips = true,
  showSaveButton = true,
  onToggleSave,
  onItemSelect,
  className,
  avatarHeadSrc,
  avatarHeight,
  avatarGender = "female",
  avatarHeightCm,
  sizeMode = "fixed",
  aspectRatio = "3 / 4",
  fluidHeight,
  fluidLayout = "card",
  renderBox,
  onMetaHeightChange,
  disableAvatarSwipe = false,
  onLongPressSave,
  slotOrder,
  animatingZone,
  onAvatarReady,
  allowEmptyMannequin = false,
  onSlotSelect,
  avatarRef,
}: OutfitInspirationCardProps) {
  const articleRef = useRef<HTMLElement>(null)
  const mountTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Lazy-load: Phase 1 (Data Fetch) vs Phase 2 (Avatar Mount) ──
  const [isHighPriority, setIsHighPriority] = useState(false)
  const [isMountedForAvatar, setIsMountedForAvatar] = useState(false)

  useEffect(() => {
    const node = articleRef.current
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsHighPriority(true)
      setIsMountedForAvatar(true)
      return
    }

    // 1. Fetch Observer: Trigger loading when within 2000px.
    const fetchObserver = new IntersectionObserver(
      ([entry]) => {
        // Hysteresis: unmount avatar only when it leaves the larger fetch boundary
        if (!entry.isIntersecting) {
          setIsMountedForAvatar(false)
          if (mountTimeoutRef.current) {
            clearTimeout(mountTimeoutRef.current)
            mountTimeoutRef.current = null
          }
        }
      },
      { rootMargin: "2000px" },
    )

    // 2. Priority Observer: Determine if we should use HIGH fetch priority (within 200px)
    const priorityObserver = new IntersectionObserver(
      ([entry]) => setIsHighPriority(entry.isIntersecting),
      { rootMargin: "200px" }
    )

    // 3. Avatar Mount Observer: Mount heavier mannequin only when closer (600px) + debounced
    const mountObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Clear any existing timer to avoid race conditions
          if (mountTimeoutRef.current) clearTimeout(mountTimeoutRef.current)

          mountTimeoutRef.current = setTimeout(() => {
            setIsMountedForAvatar(true)
            mountTimeoutRef.current = null
          }, 250)
        } else {
          // If we scroll out of the 600px zone FAST, cancel the pending mount task
          if (mountTimeoutRef.current) {
            clearTimeout(mountTimeoutRef.current)
            mountTimeoutRef.current = null
          }
        }
      },
      { rootMargin: "600px" },
    )

    fetchObserver.observe(node)
    priorityObserver.observe(node)
    mountObserver.observe(node)

    return () => {
      fetchObserver.disconnect()
      priorityObserver.disconnect()
      mountObserver.disconnect()
      if (mountTimeoutRef.current) {
        clearTimeout(mountTimeoutRef.current)
        mountTimeoutRef.current = null
      }
    }
  }, [])

  const config = variantConfig[variant]
  const visibleChips = showChips ? chips : []
  const hasExplicitRenderedItems = renderedItems != null
  const shouldFetchOutfitProducts = Boolean(outfitId) && !hasExplicitRenderedItems

  const outfitProducts = useOutfitProducts({
    outfitId: outfitId ?? null,
    enabled: shouldFetchOutfitProducts,
  })
  const { skinTone, hairStyleId, hairColorHex } = useProfileContext()
  const hairStylesQuery = useAvatarHairStyles(avatarGender)
  const mannequinQuery = useMannequinConfig({ gender: avatarGender })
  const hookDerivedItems = outfitId ? outfitProducts.data : []
  const resolvedRenderedItems = useMemo<StudioRenderedItem[]>(() => {
    if (hasExplicitRenderedItems) {
      return renderedItems ?? []
    }
    if (hookDerivedItems.length) {
      return hookDerivedItems
    }
    return []
  }, [hasExplicitRenderedItems, hookDerivedItems, renderedItems])
  const visibleSegments = useMemo(() => {
    if (hookDerivedItems.length) {
      return computeOutfitVisibleSegments(hookDerivedItems)
    }
    if (resolvedRenderedItems.length) {
      return computeOutfitVisibleSegments(resolvedRenderedItems)
    }
    return undefined
  }, [hookDerivedItems.length, hookDerivedItems, resolvedRenderedItems])
  const handleRenderedItemSelect = useMemo(
    () =>
      onItemSelect
        ? (item: StudioRenderedItem) => {
            onItemSelect(studioRenderedItemToOutfitItem(item))
          }
        : undefined,
    [onItemSelect],
  )
  const hasAvatar = (resolvedRenderedItems.length > 0 || allowEmptyMannequin) && Boolean(mannequinQuery.data)
  const resolvedHairStyle = useMemo(() => {
    if (!hairStylesQuery.data.length) {
      return null
    }
    if (hairStyleId && hairStylesQuery.byId.has(hairStyleId)) {
      return hairStylesQuery.byId.get(hairStyleId) ?? null
    }
    return hairStylesQuery.defaultStyle
  }, [hairStyleId, hairStylesQuery.byId, hairStylesQuery.data.length, hairStylesQuery.defaultStyle])

  const resolvedAvatarHeight = avatarHeight ?? (variant === "wide" ? 188 : 176)
  const isFluid = sizeMode === "fluid"

  
  // Handler for segment clicks on bare mannequin
  const handleSegmentSelect = (segment: MannequinSegmentName) => {
    if (!onSlotSelect) return
    if (segment === "legs") {
      onSlotSelect("bottom")
    } else if (segment === "feet") {
      onSlotSelect("shoes")
    } else {
      // Default to top for torso, arms, head, neck
      onSlotSelect("top")
    }
  }
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)
  const metadataRef = useRef<HTMLDivElement | null>(null)
  const isFluidAvatarOnly = isFluid && fluidLayout === "avatar"
  const shouldRenderMetadata = (showTitle && !!title) || visibleChips.length > 0

  useEffect(() => {
    if (!isFluid) {
      return
    }
    const parentElement = articleRef.current?.parentElement
    if (!parentElement || typeof ResizeObserver === "undefined") {
      return
    }

    const updateSize = () => {
      const { height, width } = parentElement.getBoundingClientRect()
      if (height > 0) {
        setMeasuredHeight(height)
      }
      if (width > 0) {
        setMeasuredWidth(width)
      }
    }

    updateSize()

    const observer = new ResizeObserver(() => updateSize())
    observer.observe(parentElement)

    return () => {
      observer.disconnect()
    }
  }, [isFluid])

  useEffect(() => {
    if (!onMetaHeightChange) {
      return
    }

    if (!shouldRenderMetadata) {
      onMetaHeightChange(0)
      return
    }

    const node = metadataRef.current
    if (!node) {
      onMetaHeightChange(0)
      return
    }

    const update = () => {
      onMetaHeightChange(node.getBoundingClientRect().height)
    }

    update()

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(() => update())
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [onMetaHeightChange, shouldRenderMetadata, visibleChips, title])

  const parsedAspectRatio = useMemo(() => {
    if (!aspectRatio) return 1
    const [numeratorStr, denominatorStr] = aspectRatio.split("/").map((part) => part.trim())
    const numerator = Number(numeratorStr)
    const denominator = Number(denominatorStr || 1)
    if (!Number.isFinite(numerator) || numerator <= 0) return 1
    if (!Number.isFinite(denominator) || denominator <= 0) return 1
    return numerator / denominator
  }, [aspectRatio])

  const hasExternalFluidHeight = typeof fluidHeight === "number" && fluidHeight > 0
  const targetHeight = isFluid
    ? hasExternalFluidHeight
      ? fluidHeight
      : measuredHeight ?? resolvedAvatarHeight
    : resolvedAvatarHeight
  const targetWidth = targetHeight * parsedAspectRatio
  const availableWidth = measuredWidth ?? targetWidth
  const hasRenderBox = Boolean(renderBox && renderBox.width > 0 && renderBox.height > 0)
  const renderBoxHeight = hasRenderBox ? renderBox!.height : targetHeight
  const renderBoxWidth = hasRenderBox ? renderBox!.width : targetWidth
  const scale = hasRenderBox ? Math.min(availableWidth / renderBoxWidth, targetHeight / renderBoxHeight) : 1
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1

  const isWaitingForOutfitProducts =
    shouldFetchOutfitProducts && resolvedRenderedItems.length === 0 && outfitProducts.isFetching
  const isWaitingForMannequin = resolvedRenderedItems.length > 0 && !mannequinQuery.data && mannequinQuery.isLoading
  // When explicit items are passed but empty, parent is still loading - show loading placeholder
  // FIX: If allowEmptyMannequin is true, we should NOT wait for items
  const isWaitingForExplicitItems = !allowEmptyMannequin && hasExplicitRenderedItems && resolvedRenderedItems.length === 0 && !outfitProducts.isError
  // Don't show fallback image while mannequin is loading - show loading placeholder instead
  const shouldRenderFallbackImage = !hasAvatar && !!fallbackImageSrc && !isWaitingForMannequin && !isWaitingForExplicitItems
  const shouldRenderLoadingPlaceholder = !hasAvatar && !shouldRenderFallbackImage && (isWaitingForOutfitProducts || isWaitingForMannequin || isWaitingForExplicitItems)
  // Only show empty placeholder when loading is complete and no items returned
  const shouldRenderEmptyPlaceholder =
    !hasAvatar && !shouldRenderFallbackImage && !shouldRenderLoadingPlaceholder
  const emptyPlaceholderLabel = outfitProducts.isError
    ? "Unable to load preview"
    : shouldFetchOutfitProducts && resolvedRenderedItems.length === 0
      ? "No outfit items"
      : "Preview unavailable"

  // Basic long-press detection for the save button
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)
  const startLongPress = () => {
    if (!onLongPressSave) return
    longPressTimeout.current = setTimeout(() => {
      longPressTriggered.current = true
      onLongPressSave()
    }, 500)
  }
  const cancelLongPress = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current)
      longPressTimeout.current = null
    }
  }

  const handleSaveClick = () => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false
      return
    }
    onToggleSave?.()
  }

  const avatarWrapperClasses = cn(
    "relative flex w-full items-center justify-center overflow-hidden rounded-xl",
    variant === "wide" ? "py-1" : "py-1",
    isFluid && fluidLayout === "card" && "h-full",
  )

  const avatarWrapperStyle: CSSProperties | undefined = isFluid
    ? fluidLayout === "card"
      ? { height: "100%", minHeight: 0 }
      : { height: targetHeight, minHeight: 0, width: "100%" }
    : { minHeight: resolvedAvatarHeight }

  const articleStyle: CSSProperties | undefined =
    isFluid && fluidLayout === "card"
      ? { height: targetHeight, aspectRatio }
      : undefined

  return (
    <article
      ref={articleRef}
      className={cn(
        "flex flex-col gap-1",
        isFluid ? "h-full" : config.containerWidth,
        className,
      )}
      style={articleStyle}
    >
      <div className={avatarWrapperClasses} style={avatarWrapperStyle}>
        {!isMountedForAvatar ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/20" aria-label="Loading preview" />
        ) : hasAvatar && mannequinQuery.data ? (
          hasRenderBox ? (
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                height: renderBoxHeight,
                width: renderBoxWidth,
                transform: `translate(-50%, -50%) scale(${normalizedScale})`,
                transformOrigin: "center",
              }}
            >
              <AvatarRenderer
                mannequinConfig={mannequinQuery.data}
                items={resolvedRenderedItems}
                containerHeight={renderBoxHeight}
                containerWidth={renderBoxWidth}
                gender={avatarGender}
                skinToneHex={skinTone}
                hairStyle={resolvedHairStyle ? {
                  assetUrl: resolvedHairStyle.assetUrl,
                  lengthPct: resolvedHairStyle.lengthPct,
                  yOffsetPct: resolvedHairStyle.yOffsetPct,
                  xOffsetPct: resolvedHairStyle.xOffsetPct,
                  zIndex: resolvedHairStyle.zIndex,
                } : null}
                hairColorHex={hairColorHex}
                visibleSegments={visibleSegments}
                onItemSelect={handleRenderedItemSelect}
                onSegmentSelect={handleSegmentSelect}
                slotOrder={slotOrder}
                animatingZone={animatingZone}
                onReady={onAvatarReady}
                avatarRef={avatarRef}
                fetchPriority={isHighPriority ? "high" : "low"}
              />
            </div>
          ) : (
            <AvatarRenderer
              mannequinConfig={mannequinQuery.data}
              items={resolvedRenderedItems}
              containerHeight={targetHeight}
              containerWidth={isFluid ? targetWidth : resolvedAvatarHeight}
              gender={avatarGender}
              skinToneHex={skinTone}
              hairStyle={resolvedHairStyle ? {
                assetUrl: resolvedHairStyle.assetUrl,
                lengthPct: resolvedHairStyle.lengthPct,
                yOffsetPct: resolvedHairStyle.yOffsetPct,
                xOffsetPct: resolvedHairStyle.xOffsetPct,
                zIndex: resolvedHairStyle.zIndex,
              } : null}
              hairColorHex={hairColorHex}
              visibleSegments={visibleSegments}
              onItemSelect={handleRenderedItemSelect}
              slotOrder={slotOrder}
              animatingZone={animatingZone}
              onReady={onAvatarReady}
              avatarRef={avatarRef}
              fetchPriority={isHighPriority ? "high" : "low"}
            />
          )
        ) : shouldRenderFallbackImage ? (
          <img
            src={fallbackImageSrc}
            alt={title ?? "Inspiration look"}
            loading="lazy"
            className="h-full w-full object-contain p-2"
          />
        ) : shouldRenderLoadingPlaceholder ? (
          <div className="flex h-full w-full animate-pulse items-center justify-center bg-muted/30 text-[10px] text-muted-foreground" aria-label="Loading preview">
            Loading outfit…
          </div>
        ) : shouldRenderEmptyPlaceholder ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/20 px-2 text-center text-[10px] text-muted-foreground">
            {emptyPlaceholderLabel}
          </div>
        ) : (
          <div className="h-full w-full" />
        )}

        {showSaveButton ? (
          <IconButton
            tone="ghost"
            size="xs"
            aria-pressed={isSaved}
            aria-label="Toggle save inspiration"
            onClick={(event) => {
              event.stopPropagation()
              handleSaveClick()
            }}
            onMouseDown={(event) => {
              event.stopPropagation()
              startLongPress()
            }}
            onMouseUp={(event) => {
              event.stopPropagation()
              cancelLongPress()
            }}
            onMouseLeave={cancelLongPress}
            onTouchStart={(event) => {
              event.stopPropagation()
              startLongPress()
            }}
            onTouchEnd={(event) => {
              event.stopPropagation()
              cancelLongPress()
            }}
            style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
            className={cn(
              "absolute right-1 top-1 size-6 items-center justify-center rounded-xl text-muted-foreground/80 select-none",
              isSaved && "text-red-500"
            )}
          >
            <Heart
              className={cn("h-3 w-3", isSaved ? "fill-current text-red-500" : "text-muted-foreground/80")}
              aria-hidden="true"
            />
          </IconButton>
        ) : null}

        {attribution ? (
          <div className="absolute bottom-0.5 right-1 flex items-center justify-end px-0.5">
            <span className="rounded-md px-1 text-[7px] font-thin text-muted-foreground">
              {attribution}
            </span>
          </div>
        ) : null}
      </div>

      {shouldRenderMetadata ? (
        <div ref={metadataRef} className="flex flex-col gap-1">
          {showTitle && title ? (
            <p className={cn("text-[9px] font-normal text-foreground", config.titleClamp)}>{title}</p>
          ) : null}
          {visibleChips.length ? (
            <div className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap scrollbar-hide">
              {visibleChips.map((chip, index) => (
                <span
                  key={`${chip}-${index}`}
                  className="inline-flex items-center justify-center rounded-full bg-muted/50 px-2 py-1 text-[0.5rem] font-medium leading-none text-foreground transition-colors duration-200 hover:bg-muted/75"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export default OutfitInspirationCard
