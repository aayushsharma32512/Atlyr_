import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import { garmentCropStyle, shouldCropToContent } from "@/design-system/utils/garment-crop"
import { probeGarmentBounds, type GarmentBounds } from "@/design-system/utils/image-alpha-bounds"

/**
 * Probed once per URL for the life of the tab. The result is a handful of
 * numbers, and the probe costs a decode plus a 256px alpha scan, so a grid of
 * repeated garments pays for each image once rather than once per tile.
 */
const cache = new Map<string, Promise<GarmentBounds>>()

function boundsFor(url: string): Promise<GarmentBounds> {
  const hit = cache.get(url)
  if (hit) return hit
  const probe = probeGarmentBounds(url)
  cache.set(url, probe)
  return probe
}

export interface GarmentImageProps {
  src: string
  alt: string
  /**
   * Frame the garment rather than the canvas it was authored on. Only takes
   * effect when the image really is mostly transparent, so photographs are
   * unaffected.
   */
  cropToContent?: boolean
  /** Share of the frame the garment fills once cropped. Lower it to clear overlays. */
  fill?: number
  loading?: "lazy" | "eager"
  onError?: () => void
  className?: string
}

/**
 * A garment image that can frame its own content.
 *
 * Segmented cutouts are authored on the full placement canvas, so a pair of
 * shoes is a 2.5% sliver at the bottom of a tall transparent image and renders
 * as an apparently empty card. Cropping is display-only: the stored asset is
 * what the mannequin renderer is calibrated against and is never touched.
 */
export function GarmentImage({
  src,
  alt,
  cropToContent = false,
  fill,
  loading = "lazy",
  onError,
  className,
}: GarmentImageProps) {
  const frameRef = useRef<HTMLSpanElement | null>(null)
  const [bounds, setBounds] = useState<GarmentBounds | null>(null)
  const [frameAspect, setFrameAspect] = useState(1)

  useEffect(() => {
    if (!cropToContent || !src) {
      setBounds(null)
      return
    }
    let alive = true
    boundsFor(src)
      .then((result) => {
        if (alive) setBounds(result)
      })
      .catch(() => {
        if (alive) setBounds(null)
      })
    return () => {
      alive = false
    }
  }, [cropToContent, src])

  // The frame's own aspect decides the maths; percentages resolve against its
  // width and height separately. No transforms here, so measuring is honest.
  useEffect(() => {
    const node = frameRef.current
    if (!cropToContent || !node || typeof ResizeObserver === "undefined") return
    const measure = () => {
      const { width, height } = node.getBoundingClientRect()
      if (width > 0 && height > 0) setFrameAspect(width / height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [cropToContent])

  const crop = bounds && shouldCropToContent(bounds) ? garmentCropStyle(bounds, frameAspect, fill) : null

  return (
    <span ref={frameRef} className="absolute inset-0 block overflow-hidden">
      <img
        src={src}
        alt={alt}
        loading={loading}
        onError={onError}
        style={crop ?? undefined}
        className={cn(crop ? "max-w-none" : "h-full w-full object-contain p-2", className)}
      />
    </span>
  )
}
