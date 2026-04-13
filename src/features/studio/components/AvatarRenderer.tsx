import type { CSSProperties } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type {
  MannequinConfig,
  MannequinSegmentName,
  SegmentDimensions,
  StudioRenderedItem,
  StudioRenderedZone,
  ZoneVisibilityMap,
} from "@/features/studio/types"
import {
  DEFAULT_USER_HEIGHT_CM,
  computeHeadScale,
  getPxPerCm,
  getSegmentLengthPx,
} from "@/features/studio/utils/avatarMath"
import { DEFAULT_VISIBLE_SEGMENTS, MANNEQUIN_SKIN_HEXES } from "@/features/studio/constants"

const BODY_SEGMENTS: MannequinSegmentName[] = ["neck", "torso", "arm_left", "arm_right", "legs", "feet"]

// In-memory cache for SVG assets
const segmentAssetCache = new Map<string, { markup: string; dimensions: SegmentDimensions }>()
const hairAssetCache = new Map<string, { markup: string; dimensions: SegmentDimensions }>()

// localStorage key for persisting SVG cache across page reloads
const SVG_CACHE_VERSION = 5
const SVG_CACHE_KEY = `landing-mannequin-svg-cache-v${SVG_CACHE_VERSION}`
const SVG_CACHE_PREVIOUS_KEY = `landing-mannequin-svg-cache-v${SVG_CACHE_VERSION - 1}`
const HAIR_SVG_CACHE_KEY = `landing-mannequin-hair-svg-cache-v${SVG_CACHE_VERSION}`
const HAIR_SVG_CACHE_PREVIOUS_KEY = `landing-mannequin-hair-svg-cache-v${SVG_CACHE_VERSION - 1}`

try {
  localStorage.removeItem(SVG_CACHE_PREVIOUS_KEY)
  localStorage.removeItem(HAIR_SVG_CACHE_PREVIOUS_KEY)
} catch {
  // Ignore localStorage errors (private browsing, etc.)
}

// Try to restore cache from localStorage on initial load
try {
  const stored = localStorage.getItem(SVG_CACHE_KEY)
  if (stored) {
    const parsed = JSON.parse(stored) as Record<string, { markup: string; dimensions: SegmentDimensions }>
    Object.entries(parsed).forEach(([key, value]) => {
      segmentAssetCache.set(key, value)
    })
  }
} catch {
  // Ignore localStorage errors (private browsing, etc.)
}

try {
  const stored = localStorage.getItem(HAIR_SVG_CACHE_KEY)
  if (stored) {
    const parsed = JSON.parse(stored) as Record<string, { markup: string; dimensions: SegmentDimensions }>
    Object.entries(parsed).forEach(([key, value]) => {
      hairAssetCache.set(key, value)
    })
  }
} catch {
  // Ignore localStorage errors (private browsing, etc.)
}

// Helper to save cache to localStorage
function saveCacheToStorage() {
  try {
    const obj: Record<string, { markup: string; dimensions: SegmentDimensions }> = {}
    segmentAssetCache.forEach((value, key) => {
      obj[key] = value
    })
    localStorage.setItem(SVG_CACHE_KEY, JSON.stringify(obj))
  } catch {
    // Ignore localStorage errors
  }
}

function saveHairCacheToStorage() {
  try {
    const obj: Record<string, { markup: string; dimensions: SegmentDimensions }> = {}
    hairAssetCache.forEach((value, key) => {
      obj[key] = value
    })
    localStorage.setItem(HAIR_SVG_CACHE_KEY, JSON.stringify(obj))
  } catch {
    // Ignore localStorage errors
  }
}

type SegmentSvgMap = Record<MannequinSegmentName, string>
type SegmentDimMap = Record<MannequinSegmentName, SegmentDimensions>

type HairStyleConfig = {
  assetUrl: string
  lengthPct: number
  yOffsetPct: number
  xOffsetPct: number
  zIndex: number
} | null

interface AvatarRendererProps {
  mannequinConfig: MannequinConfig | null
  items: StudioRenderedItem[]
  containerHeight?: number
  containerWidth?: number
  gender?: "male" | "female"
  skinToneValue?: number
  skinToneHex?: string | null
  hairStyle?: HairStyleConfig
  hairColorHex?: string | null
  visibleSegments?: MannequinSegmentName[]
  zoneAssetOverrides?: ZoneVisibilityMap
  itemOpacity?: number
  blurEnabled?: boolean
  blurAmount?: number
  blurZIndex?: number
  showHead?: boolean
  showBody?: boolean
  onItemSelect?: (item: StudioRenderedItem) => void
  onSegmentSelect?: (segment: MannequinSegmentName) => void
  slotOrder?: StudioRenderedZone[]
  /** Zone that just changed - used for per-item animations */
  animatingZone?: StudioRenderedZone | null
  /** Callback when avatar is fully loaded and ready to display */
  onReady?: (ready: boolean) => void
  /** Ref to the avatar container element for snapshot capture */
  avatarRef?: React.Ref<HTMLDivElement>
  /** Hint to the browser for image loading priority */
  fetchPriority?: "high" | "low" | "auto"
}

interface LoadedItemData {
  id: string
  url: string
  dimensions: { width: number; height: number }
}

export function AvatarRenderer({
  mannequinConfig,
  items,
  containerHeight = 460,
  containerWidth = 320,
  gender = "female",
  skinToneValue = 0.35,
  skinToneHex = null,
  hairStyle = null,
  hairColorHex = null,
  visibleSegments,
  zoneAssetOverrides,
  itemOpacity = 1,
  blurEnabled = false,
  blurAmount = 5,
  blurZIndex = 1,
  showHead = true,
  showBody = true,
  onItemSelect,
  onSegmentSelect,
  slotOrder,
  animatingZone,
  onReady,
  avatarRef,
  fetchPriority = "auto",
}: AvatarRendererProps) {
  const [segmentMarkup, setSegmentMarkup] = useState<SegmentSvgMap>({} as SegmentSvgMap)
  const [segmentDimensions, setSegmentDimensions] = useState<SegmentDimMap>({} as SegmentDimMap)
  const [assetsReady, setAssetsReady] = useState(false)
  const [hairMarkup, setHairMarkup] = useState("")
  const [hairDimensions, setHairDimensions] = useState<SegmentDimensions | null>(null)
  const [hairReady, setHairReady] = useState(true)
  const [itemData, setItemData] = useState<Record<string, LoadedItemData>>({})
  // Cache known image dimensions keyed by URL so a changed URL for the same
  // item.id correctly triggers a fresh load + decode cycle.
  const dimensionCache = useRef<Record<string, { width: number; height: number }>>({})
  // Track which images in the actual DOM have fired onLoad (ready to paint)
  const [loadedImageIds, setLoadedImageIds] = useState<Set<string>>(new Set())
  // Track previous URL per item.id so we can detect URL changes
  const prevUrlMap = useRef<Record<string, string>>({})
  // Guard against state updates after unmount (onLoad/onError can fire late)
  const isMountedRef = useRef(true)

  useEffect(() => {
    // Reset on (re-)mount — required for React StrictMode double-mount cycle
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Clear caches on unmount to free memory
      dimensionCache.current = {}
      prevUrlMap.current = {}
    }
  }, [])

  // Load SVG assets + determine dimensions
  useEffect(() => {
    if (!mannequinConfig) {
      setSegmentMarkup({} as SegmentSvgMap)
      setSegmentDimensions({} as SegmentDimMap)
      setAssetsReady(false)
      return
    }
    let cancelled = false
    const segmentEntries = Object.entries(mannequinConfig.segments) as [MannequinSegmentName, typeof mannequinConfig.segments[MannequinSegmentName]][]

    const loaders = segmentEntries.map(async ([name, config]) => {
      const cacheKey = config.assetUrl
      const cached = cacheKey ? segmentAssetCache.get(cacheKey) : undefined
      if (cached) {
        return { name, markup: cached.markup, dimensions: cached.dimensions }
      }
      try {
        const response = await fetch(config.assetUrl)
        const raw = await response.text()
        const sanitized = sanitizeSvgMarkup(raw)
        const dims = extractSvgDimensions(raw)
        if (cacheKey) {
          segmentAssetCache.set(cacheKey, { markup: sanitized, dimensions: dims })
        }
        return { name, markup: sanitized, dimensions: dims }
      } catch {
        return {
          name,
          markup: "",
          dimensions: { width: 100, height: 100 },
        }
      }
    })

    Promise.all(loaders).then((results) => {
      if (cancelled) return
      const markupMap: Partial<SegmentSvgMap> = {}
      const dimMap: Partial<SegmentDimMap> = {}
      results.forEach((entry) => {
        markupMap[entry.name] = entry.markup
        dimMap[entry.name] = entry.dimensions
      })
      setSegmentMarkup(markupMap as SegmentSvgMap)
      setSegmentDimensions(dimMap as SegmentDimMap)
      setAssetsReady(true)
      // Persist cache to localStorage for faster subsequent loads
      saveCacheToStorage()
    })

    return () => {
      cancelled = true
    }
  }, [mannequinConfig])

  useEffect(() => {
    const assetUrl = hairStyle?.assetUrl ?? ""
    if (!assetUrl || typeof window === "undefined") {
      setHairMarkup("")
      setHairDimensions(null)
      setHairReady(true)
      return
    }

    let cancelled = false
    setHairReady(false)

    const cached = hairAssetCache.get(assetUrl)
    if (cached) {
      setHairMarkup(cached.markup)
      setHairDimensions(cached.dimensions)
      setHairReady(true)
      return
    }

    fetch(assetUrl)
      .then((response) => response.text())
      .then((raw) => {
        if (cancelled) return
        const sanitized = sanitizeHairSvgMarkup(raw)
        const dims = extractSvgDimensions(raw)
        hairAssetCache.set(assetUrl, { markup: sanitized, dimensions: dims })
        setHairMarkup(sanitized)
        setHairDimensions(dims)
        setHairReady(true)
        saveHairCacheToStorage()
      })
      .catch(() => {
        if (cancelled) return
        setHairMarkup("")
        setHairDimensions({ width: 100, height: 100 })
        setHairReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [hairStyle?.assetUrl])

  // Build item data from items + dimension cache. No async probe needed —
  // dimensions come from the cache (populated on first onLoad) or use
  // fallback values until the actual DOM <img> fires onLoad.
  useEffect(() => {
    if (!items.length) {
      setItemData({})
      setLoadedImageIds(new Set())
      prevUrlMap.current = {}
      return
    }

    const newData: Record<string, LoadedItemData> = {}
    const urlChanged = new Set<string>()
    const currentItemIds = new Set<string>()
    items.forEach((item) => {
      currentItemIds.add(item.id)
      // Check if URL changed for this item.id
      const prevUrl = prevUrlMap.current[item.id]
      if (prevUrl && prevUrl !== item.imageUrl) {
        urlChanged.add(item.id)
      }
      prevUrlMap.current[item.id] = item.imageUrl

      const cachedDims = dimensionCache.current[item.imageUrl]
      newData[item.id] = {
        id: item.id,
        url: item.imageUrl,
        dimensions: cachedDims ?? { width: 120, height: 120 },
      }
    })
    // Prune stale entries from prevUrlMap to prevent unbounded growth
    for (const id of Object.keys(prevUrlMap.current)) {
      if (!currentItemIds.has(id)) {
        delete prevUrlMap.current[id]
      }
    }
    setItemData(newData)
    // Reset loaded tracking — new items and URL-changed items need fresh onLoad
    setLoadedImageIds((prev) => {
      const next = new Set<string>()
      items.forEach((item) => {
        // Keep items that are still present, were already loaded, AND whose URL hasn't changed
        if (prev.has(item.id) && !urlChanged.has(item.id)) next.add(item.id)
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // Callback for when an actual DOM <img> fires onLoad — cache its
  // natural dimensions and mark it as ready to reveal.
  const handleItemImgLoad = useCallback((itemId: string, imageUrl: string, img: HTMLImageElement) => {
    // Always update dimension cache (keyed by URL) with latest values
    dimensionCache.current[imageUrl] = {
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
    // Guard against state updates after unmount
    if (!isMountedRef.current) return
    // Update itemData with real dimensions
    setItemData((prev) => {
      const existing = prev[itemId]
      if (!existing) return prev
      return {
        ...prev,
        [itemId]: {
          ...existing,
          dimensions: { width: img.naturalWidth, height: img.naturalHeight },
        },
      }
    })
    setLoadedImageIds((prev) => {
      if (prev.has(itemId)) return prev
      const next = new Set(prev)
      next.add(itemId)
      return next
    })
  }, [])

  // Callback for image error — mark as loaded so the UI doesn't get stuck.
  const handleItemImgError = useCallback((itemId: string) => {
    if (!isMountedRef.current) return
    setLoadedImageIds((prev) => {
      if (prev.has(itemId)) return prev
      const next = new Set(prev)
      next.add(itemId)
      return next
    })
  }, [])

  // All clothing images are painted when every item has fired onLoad
  const allImagesLoaded = items.length === 0 || (
    items.length > 0 && items.every((item) => loadedImageIds.has(item.id))
  )

  const userHeightCm = mannequinConfig?.heightCm ?? DEFAULT_USER_HEIGHT_CM[gender]
  const headDims = segmentDimensions.head ?? { width: 1, height: 1 }

  const { userHeightPx, pxPerCm, headResult } = useMemo(() => {
    let currentUserHeightPx = containerHeight
    let pxPerCmValue = getPxPerCm(currentUserHeightPx, userHeightCm)
    let headMetrics = computeHeadScale(headDims, userHeightCm, pxPerCmValue)

    for (let i = 0; i < 3; i++) {
      const nextUserHeightPx = Math.max(1, containerHeight - headMetrics.chinOffsetPx)
      if (Math.abs(nextUserHeightPx - currentUserHeightPx) < 0.5) {
        currentUserHeightPx = nextUserHeightPx
        pxPerCmValue = getPxPerCm(currentUserHeightPx, userHeightCm)
        headMetrics = computeHeadScale(headDims, userHeightCm, pxPerCmValue)
        break
      }
      currentUserHeightPx = nextUserHeightPx
      pxPerCmValue = getPxPerCm(currentUserHeightPx, userHeightCm)
      headMetrics = computeHeadScale(headDims, userHeightCm, pxPerCmValue)
    }

    return { userHeightPx: currentUserHeightPx, pxPerCm: pxPerCmValue, headResult: headMetrics }
  }, [containerHeight, userHeightCm, headDims])

  const { scaledHead, headScale, chinOffsetPx } = headResult

  const resolvedSegments = useMemo(() => {
    let baseSegments: MannequinSegmentName[]
    if (visibleSegments !== undefined) {
      baseSegments = visibleSegments
    } else if (zoneAssetOverrides) {
      const flattened = Object.values(zoneAssetOverrides)
        .filter((segments): segments is MannequinSegmentName[] => Array.isArray(segments) && segments.length > 0)
        .flat()
      baseSegments = flattened.length ? flattened : DEFAULT_VISIBLE_SEGMENTS
    } else {
      baseSegments = DEFAULT_VISIBLE_SEGMENTS
    }
    const next = new Set<MannequinSegmentName>(baseSegments)
    if (!showHead) {
      next.delete("head")
    }
    if (!showBody) {
      BODY_SEGMENTS.forEach((segment) => next.delete(segment))
    }
    return next
  }, [visibleSegments, zoneAssetOverrides, showHead, showBody])

  const normalizedSkinTone = normalizeHex(skinToneHex)
  const clampedSkinTone = Math.min(1, Math.max(0, skinToneValue))
  const skinBaseLightness = 85 - clampedSkinTone * 40
  const skinSaturation = 35 + clampedSkinTone * 25
  const skinHue = 28
  const fallbackSkinColor = `hsl(${skinHue} ${skinSaturation}% ${skinBaseLightness}%)`
  const fallbackOutlineColor = `hsl(${skinHue} ${skinSaturation}% ${Math.max(20, skinBaseLightness - 25)}%)`
  const skinColor = normalizedSkinTone ?? fallbackSkinColor
  const outlineColor = normalizedSkinTone ? darkenHex(normalizedSkinTone, 0.7) : fallbackOutlineColor

  const globalTopOffsetPx = useMemo(() => {
    if (!hairStyle || !resolvedSegments.has("head")) {
      return 0
    }
    const hairTop = chinOffsetPx + (hairStyle.yOffsetPct / 100) * userHeightPx
    if (!Number.isFinite(hairTop) || hairTop >= 0) {
      return 0
    }
    // Add a small buffer to avoid pixel-rounding clipping at the top edge.
    return Math.ceil(-hairTop) + 1
  }, [chinOffsetPx, hairStyle, resolvedSegments, userHeightPx])

  const clothingLayers = useMemo(() => {
    if (!items.length) return []

    const grouped = {
      bottom: [] as StudioRenderedItem[],
      shoes: [] as StudioRenderedItem[],
      top: [] as StudioRenderedItem[],
    }
    items.forEach((item) => {
      if (item.zone === "bottom") grouped.bottom.push(item)
      else if (item.zone === "shoes") grouped.shoes.push(item)
      else grouped.top.push(item)
    })

    const buildLayer = (item: StudioRenderedItem, baseZ: number, index: number) => {
      const data = itemData[item.id]
      if (!data || data.dimensions.height === 0) return null
      
      const { width: imgW, height: imgH } = data.dimensions
      const aspect = imgW / imgH
      const targetHeight = pxPerCm * (item.imageLengthCm ?? 0)
      const height = targetHeight > 0 ? targetHeight : imgH * headScale
      const width = height * aspect
      const top = globalTopOffsetPx + chinOffsetPx + ((item.placementY ?? 0) / 100) * userHeightPx
      const xOffset = ((item.placementX ?? 0) / 100) * width
      return {
        key: `${item.id}-${index}`,
        item,
        url: data.url, // Use the blob URL (or fallback)
        style: {
          position: "absolute" as const,
          left: `calc(50% + ${xOffset}px)`,
          transform: "translateX(-50%)",
          top,
          width,
          height,
          zIndex: baseZ + index,
          objectFit: "contain" as const,
          pointerEvents: "auto" as const,
          opacity: Math.max(0, Math.min(1, itemOpacity)),
        },
      }
    }

    const defaultOrder: StudioRenderedZone[] = ["top", "bottom", "shoes"]
    const resolvedOrder = slotOrder && slotOrder.length > 0 ? slotOrder : defaultOrder
    const maxZ = 4 + Math.max(0, resolvedOrder.length - 1)
    const zMap = new Map<StudioRenderedZone, number>()
    resolvedOrder.forEach((zone, index) => {
      zMap.set(zone, maxZ - index)
    })

    const layers = resolvedOrder
      .flatMap((zone) => {
        const zoneItems = grouped[zone]
        const baseZ = zMap.get(zone) ?? 4
        return zoneItems.map((item, index) => buildLayer(item, baseZ, index))
      })
      .filter(Boolean) as Array<{ key: string; item: StudioRenderedItem; url: string; style: CSSProperties }>

    return layers
  }, [items, itemData, pxPerCm, headScale, chinOffsetPx, globalTopOffsetPx, itemOpacity, userHeightPx, slotOrder])

  const renderSegment = useCallback(
    (name: MannequinSegmentName) => {
      if (!assetsReady || !mannequinConfig) return null
      if (!resolvedSegments.has(name)) return null
      const config = mannequinConfig.segments[name]
      const markup = segmentMarkup[name]
      const baseDimensions = segmentDimensions[name]
      if (!markup || !baseDimensions) return null

      const lengthPx = name === "head" ? scaledHead.height : getSegmentLengthPx(config.lengthPct, userHeightPx)
      const aspect = baseDimensions.width / (baseDimensions.height || 1)
      const widthPx = name === "head" ? scaledHead.width : lengthPx * aspect
      const top = name === "head"
        ? globalTopOffsetPx
        : globalTopOffsetPx + chinOffsetPx + (config.placementYPct / 100) * userHeightPx

      let xOffsetPx = 0
      if (name === "arm_left" || name === "arm_right") {
        const torsoConfig = mannequinConfig.segments.torso
        const torsoDims = segmentDimensions.torso ?? { width: 1, height: 1 }
        const torsoLengthPx = getSegmentLengthPx(torsoConfig.lengthPct, userHeightPx)
        const torsoAspect = torsoDims.width / (torsoDims.height || 1)
        const renderedTorsoWidth = torsoLengthPx * torsoAspect
        const offsetPercent = config.xOffsetPct ?? 0
        xOffsetPx = offsetPercent * renderedTorsoWidth
      }

      const styledMarkup = markup
        .replace(/var\(--mannequin-skin\)/g, skinColor)
        .replace(/var\(--mannequin-outline\)/g, outlineColor)
      
      const isInteractive = Boolean(onSegmentSelect)

      return (
        <div
          key={name}
          aria-label={`${name} segment`}
          className={cn(
             "absolute select-none",
             isInteractive && "cursor-pointer"
          )}
          style={{
            left: "50%",
            top,
            width: widthPx,
            height: lengthPx,
            transform: `translateX(calc(-50% + ${xOffsetPx}px))`,
            zIndex: config.zIndex,
            pointerEvents: isInteractive ? "auto" : "none",
          }}
          dangerouslySetInnerHTML={{ __html: styledMarkup }}
          onClick={(e) => {
            if (isInteractive) {
                e.stopPropagation()
                onSegmentSelect?.(name)
            }
          }}
        />
      )
    },
    [
      assetsReady,
      mannequinConfig,
      resolvedSegments,
      segmentMarkup,
      segmentDimensions,
      scaledHead.height,
      scaledHead.width,
      userHeightPx,
      chinOffsetPx,
      globalTopOffsetPx,
      skinColor,
      outlineColor,
      onSegmentSelect,
    ],
  )

  const showLoading = !assetsReady || !hairReady
  // Images are "revealed" once the skeleton is gone AND all actual DOM imgs loaded
  const imagesRevealed = !showLoading && allImagesLoaded
  
  // Notify parent when ready state changes
  useEffect(() => {
    onReady?.(imagesRevealed)
  }, [imagesRevealed, onReady])

  const shouldRenderHair = Boolean(
    hairStyle &&
      hairMarkup &&
      hairDimensions &&
      resolvedSegments.has("head"),
  )

  const hairLayer = useMemo(() => {
    if (!shouldRenderHair || !hairStyle || !hairDimensions) {
      return null
    }

    const lengthPx = getSegmentLengthPx(hairStyle.lengthPct, userHeightPx)
    const aspect = hairDimensions.width / (hairDimensions.height || 1)
    const widthPx = lengthPx * aspect
    const top = globalTopOffsetPx + chinOffsetPx + (hairStyle.yOffsetPct / 100) * userHeightPx
    const xOffsetPx = (hairStyle.xOffsetPct / 100) * widthPx

    const markup = hairColorHex ? applyHairColorToSvg(hairMarkup, hairColorHex) : hairMarkup

    return {
      markup,
      style: {
        left: "50%",
        top,
        width: widthPx,
        height: lengthPx,
        transform: `translateX(calc(-50% + ${xOffsetPx}px))`,
        zIndex: hairStyle.zIndex,
      } as CSSProperties,
    }
  }, [chinOffsetPx, globalTopOffsetPx, hairColorHex, hairDimensions, hairMarkup, hairStyle, shouldRenderHair, userHeightPx])

  return (
    <div ref={avatarRef} data-snapshot="true" className={cn("relative bg-transparent", "overflow-hidden")} style={{ height: containerHeight, width: containerWidth }}>
      {showLoading ? (
        <div className="h-full w-full animate-pulse rounded-xl bg-muted/30" aria-label="Loading preview" />
      ) : (
        <div>
          <style>{`
            @keyframes itemFadeIn {
              from { opacity: 0.4; }
              to { opacity: 1; }
            }
          `}</style>
          {/* Mannequin segments + hair: only visible once all clothing images loaded */}
          <div style={{ visibility: imagesRevealed ? 'visible' : 'hidden' }}>
            {Array.from(resolvedSegments).map((segment) => renderSegment(segment))}
            {hairLayer ? (
              <div
                aria-hidden="true"
                className="absolute pointer-events-none select-none"
                style={hairLayer.style}
                dangerouslySetInnerHTML={{ __html: hairLayer.markup }}
              />
            ) : null}
          </div>
          {/* Clothing images: always in the DOM for onLoad tracking, hidden until all ready */}
          {clothingLayers.map((layer) => {
            const shouldAnimate = animatingZone && layer.item.zone === animatingZone
            return (
              <img
                key={shouldAnimate ? `${layer.key}-anim` : layer.key}
                src={layer.url}
                alt={layer.item.description ?? layer.item.productName ?? layer.item.brand ?? "Outfit item"}
                className="absolute select-none"
                style={{
                  ...layer.style,
                  visibility: imagesRevealed ? 'visible' : 'hidden',
                  animation: shouldAnimate && imagesRevealed ? 'itemFadeIn 250ms ease-out' : undefined,
                }}
                onLoad={(e) => handleItemImgLoad(layer.item.id, layer.url, e.currentTarget)}
                onError={() => handleItemImgError(layer.item.id)}
                onClick={() => onItemSelect?.(layer.item)}
                {...({ fetchpriority: fetchPriority } as any)}
              />
            )
          })}
          {/* Show skeleton overlay while images are loading in the background */}
          {!imagesRevealed && (
            <div className="absolute inset-0 h-full w-full animate-pulse rounded-xl bg-muted/30" aria-label="Loading preview" />
          )}
        </div>
      )}
      {blurEnabled ? (
        <div
          className="pointer-events-none"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: blurZIndex,
            backdropFilter: `blur(${blurAmount}px)`,
            WebkitBackdropFilter: `blur(${blurAmount}px)`,
          }}
        />
      ) : null}
    </div>
  )
}

function sanitizeSvgMarkup(raw: string): string {
  let result = raw
  result = result.replace(/<rect[^>]*fill="#ffffff"[^>]*>/gi, "")
  result = result.replace(/fill="#[0-9a-fA-F]{3,6}"/gi, (match) => {
    const hex = match.toLowerCase().match(/#[0-9a-f]{3,6}/)?.[0]
    if (hex && MANNEQUIN_SKIN_HEXES.has(hex)) {
      return 'fill="var(--mannequin-skin)"'
    }
    return match
  })
  result = result.replace(/stroke="#000000"/gi, 'stroke="var(--mannequin-outline)"')
  result = result.replace(/width="[^"]*"/i, 'width="100%"')
  result = result.replace(/height="[^"]*"/i, 'height="100%"')
  if (!/preserveAspectRatio/i.test(result)) {
    result = result.replace(/<svg/i, '<svg preserveAspectRatio="xMidYMid meet"')
  }
  return result
}

function extractSvgDimensions(markup: string): SegmentDimensions {
  const viewBoxMatch = markup.match(/viewBox="([^"]+)"/i)
  if (viewBoxMatch) {
    const [, values] = viewBoxMatch
    const parts = values.split(/\s+/).map(Number)
    if (parts.length === 4) {
      const width = parts[2]
      const height = parts[3]
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width, height }
      }
    }
  }
  const widthMatch = markup.match(/width="([^"]+)"/i)
  const heightMatch = markup.match(/height="([^"]+)"/i)
  const width = widthMatch ? Number(widthMatch[1].replace(/[^0-9.]/g, "")) : 100
  const height = heightMatch ? Number(heightMatch[1].replace(/[^0-9.]/g, "")) : 100
  return {
    width: Number.isFinite(width) && width > 0 ? width : 100,
    height: Number.isFinite(height) && height > 0 ? height : 100,
  }
}

function sanitizeHairSvgMarkup(raw: string): string {
  let result = raw
  result = result.replace(/<rect[^>]*fill="#ffffff"[^>]*>/gi, "")
  result = result.replace(/width="[^"]*"/i, 'width="100%"')
  result = result.replace(/height="[^"]*"/i, 'height="100%"')
  if (!/preserveAspectRatio/i.test(result)) {
    result = result.replace(/<svg/i, '<svg preserveAspectRatio="xMidYMid meet"')
  }
  return result
}

function applyHairColorToSvg(svgMarkup: string, hairColorHex: string) {
  const normalized = normalizeHex(hairColorHex)
  if (!normalized) {
    return svgMarkup
  }

  let updated = svgMarkup

  updated = updated.replace(/fill="([^"]+)"/gi, (match, value) => {
    const normalizedValue = normalizeHairFill(value)
    if (!normalizedValue) {
      return match
    }
    return `fill="${normalized}"`
  })

  updated = updated.replace(/fill:\s*([^;"]+)/gi, (match, value) => {
    const normalizedValue = normalizeHairFill(value)
    if (!normalizedValue) {
      return match
    }
    return `fill:${normalized}`
  })

  return updated
}

function normalizeHairFill(value: string) {
  const raw = value.trim().toLowerCase()
  if (raw === "none" || raw === "transparent" || raw === "currentcolor" || raw.startsWith("url(")) {
    return null
  }
  if (raw === "black") {
    return "#000000"
  }
  const normalized = normalizeHex(raw)
  if (normalized === "#000000") {
    return normalized
  }
  return null
}

function normalizeHex(value: string | null | undefined) {
  if (!value) {
    return null
  }
  let hex = value.trim().toLowerCase()
  if (!hex) {
    return null
  }
  if (!hex.startsWith("#")) {
    hex = `#${hex}`
  }
  if (hex.length === 4) {
    const [r, g, b] = hex.slice(1).split("")
    hex = `#${r}${r}${g}${g}${b}${b}`
  }
  if (!/^#[0-9a-f]{6}$/.test(hex)) {
    return null
  }
  return hex
}

function darkenHex(hex: string, factor: number) {
  const normalized = normalizeHex(hex)
  if (!normalized) {
    return hex
  }
  const r = Math.round(parseInt(normalized.slice(1, 3), 16) * factor)
  const g = Math.round(parseInt(normalized.slice(3, 5), 16) * factor)
  const b = Math.round(parseInt(normalized.slice(5, 7), 16) * factor)
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`
}

/**
 * Preload and cache mannequin segment SVGs for a given config.
 * Call this BEFORE AvatarRenderer mounts to eliminate loading state.
 * The segments will be stored in cache and reused when AvatarRenderer mounts.
 */
export async function preloadMannequinSegments(mannequinConfig: MannequinConfig | null): Promise<void> {
  if (!mannequinConfig) return
  
  const segmentEntries = Object.entries(mannequinConfig.segments) as [MannequinSegmentName, typeof mannequinConfig.segments[MannequinSegmentName]][]
  
  await Promise.all(
    segmentEntries.map(async ([, config]) => {
      const cacheKey = config.assetUrl
      // Skip if already in memory cache
      if (cacheKey && segmentAssetCache.has(cacheKey)) {
        return
      }
      try {
        const response = await fetch(config.assetUrl)
        const raw = await response.text()
        const sanitized = sanitizeSvgMarkup(raw)
        const dims = extractSvgDimensions(raw)
        if (cacheKey) {
          segmentAssetCache.set(cacheKey, { markup: sanitized, dimensions: dims })
        }
      } catch {
        // Silently fail - AvatarRenderer will handle missing segments
      }
    })
  )
  // Persist to localStorage for next visit
  saveCacheToStorage()
}

export default AvatarRenderer
