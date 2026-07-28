import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AvatarRenderer, type AvatarRenderMetrics } from '@/features/studio/components/AvatarRenderer'
import { useMannequinConfig } from '@/features/studio/hooks/useMannequinConfig'
import type { StudioRenderedItem, StudioRenderedZone } from '@/features/studio/types'
import { v2Api } from '@/utils/ingestionV2Api'

const VIEW_W = 300
const VIEW_H = 460

/**
 * Seeds for products that have never been placed. These are the per-zone averages of the products
 * already placed in the catalog, so an unplaced garment opens roughly in the right spot and only
 * needs nudging rather than being dragged up from the chin.
 */
const ZONE_DEFAULTS: Record<StudioRenderedZone, { x: number; y: number; len: number }> = {
  top:    { x: 0, y: 0,  len: 67 },
  bottom: { x: 0, y: 26, len: 93 },
  shoes:  { x: 0, y: 81, len: 20 },
}

const LIMITS = {
  x:   { min: -120, max: 120 },
  y:   { min: -40,  max: 140 },
  len: { min: 5,    max: 200 },
}

/** The catalog row shape the 2D editor needs. `type` is 'top' | 'bottom' | 'shoes' in the DB. */
export type Placement2DProduct = {
  id: string
  image_url: string | null
  gender: string | null
  type?: string | null
  product_name?: string | null
  placement_x?: number | null
  placement_y?: number | null
  image_length?: number | null
}

type Props = {
  product: Placement2DProduct | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

type Values = { x: number; y: number; len: number }

function zoneOf(type: string | null | undefined): StudioRenderedZone {
  return type === 'bottom' || type === 'shoes' ? type : 'top'
}

/** The avatar to preview on. Only male|female exist; unisex previews on male, as the 3D editor does. */
function mannequinGender(gender: string | null | undefined): 'male' | 'female' {
  return String(gender ?? '').toLowerCase().includes('female') ? 'female' : 'male'
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function round(v: number, dp = 1): number {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

/** The garment's on-screen rect — exactly what the renderer lays out, so the gizmo tracks it 1:1. */
type Rect = { left: number; top: number; w: number; h: number }

/**
 * Legacy 2D placement editor for a catalog product.
 *
 * Renders the SAME `AvatarRenderer` the studio uses (forced to the 2D SVG path) with this one
 * garment, so what is dragged here is pixel-identical to what users see. The renderer reports its
 * layout scale via `onMetrics`, which is what lets a pixel drag be inverted back into the stored
 * units:
 *
 *   placement_y  = % of the avatar's body height, from the chin  → dy / userHeightPx * 100
 *   placement_x  = % of the GARMENT's own rendered width         → dx / garmentWidthPx * 100
 *   image_length = garment length in cm                          → renders at pxPerCm * image_length
 *
 * Direct manipulation mirrors the 3D mesh editor: drag anywhere to move, corner handles scale about
 * the garment's centre. There is deliberately NO rotate handle and no warp lattice — the 2D avatar
 * renders a plain <img> positioned by top/left/width/height, and the catalog has no columns for a
 * rotation or a per-vertex mesh, so those controls would silently do nothing on save.
 *
 * Saves only the three 2D columns. The 3D `placement` map is never read or written here.
 */
export function Placement2DEditor({ product, open, onOpenChange, onSaved }: Props) {
  const zone = zoneOf(product?.type)
  const gender = mannequinGender(product?.gender)

  const [values, setValues] = useState<Values>(ZONE_DEFAULTS.top)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<AvatarRenderMetrics | null>(null)
  const [aspect, setAspect] = useState<number | null>(null)
  const [hovering, setHovering] = useState(false)
  // The interaction surface, so pointer coordinates are always resolved against the canvas box —
  // never against a 12px handle that happens to be the event target.
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  const { data: mannequinConfig, isLoading: mannequinLoading } = useMannequinConfig({ gender })

  // Seed from the product's saved values, falling back to the per-zone average for a product that
  // has never been placed. Re-seeds whenever a different product is opened.
  const seed = useMemo<Values>(() => {
    const d = ZONE_DEFAULTS[zone]
    return {
      x:   product?.placement_x  ?? d.x,
      y:   product?.placement_y  ?? d.y,
      len: product?.image_length ?? d.len,
    }
  }, [product?.placement_x, product?.placement_y, product?.image_length, zone])

  // Seed only when a different product is opened — deliberately NOT on every `seed` identity
  // change, so a background refetch of the grid can't wipe edits that are in progress.
  const seedRef = useRef(seed)
  seedRef.current = seed
  useEffect(() => {
    if (!open) return
    setValues(seedRef.current)
    setDirty(false)
    setError(null)
  }, [open, product?.id])

  // Natural dimensions of the garment image — needed for the width that placement_x is a % of.
  useEffect(() => {
    const url = product?.image_url
    if (!open || !url) { setAspect(null); return }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { if (!cancelled && img.naturalHeight > 0) setAspect(img.naturalWidth / img.naturalHeight) }
    img.onerror = () => { if (!cancelled) setAspect(null) }
    img.src = url
    return () => { cancelled = true }
  }, [open, product?.image_url])

  // Identity-stable so the renderer's metrics effect doesn't re-fire every render.
  const handleMetrics = useCallback((m: AvatarRenderMetrics) => {
    setMetrics((prev) =>
      prev && prev.userHeightPx === m.userHeightPx && prev.pxPerCm === m.pxPerCm ? prev : m,
    )
  }, [])

  const item = useMemo<StudioRenderedItem | null>(() => {
    if (!product?.image_url) return null
    return {
      id: product.id,
      zone,
      imageUrl: product.image_url,
      placementX: values.x,
      placementY: values.y,
      imageLengthCm: values.len,
      // Never pass `placement` — this editor must stay on the 2D path even for a product that
      // already has a 3D transform.
      placement: null,
    }
  }, [product?.id, product?.image_url, zone, values])

  const items = useMemo(() => (item ? [item] : []), [item])

  // The garment's rect on screen — recomputed from the SAME formulas the renderer lays out with
  // (AvatarRenderer's buildLayer), so the gizmo sits exactly on the garment at every scale.
  const rect = useMemo<Rect | null>(() => {
    if (!metrics || !aspect) return null
    const h = metrics.pxPerCm * values.len
    const w = h * aspect
    return {
      w,
      h,
      top: metrics.globalTopOffsetPx + metrics.chinOffsetPx + (values.y / 100) * metrics.userHeightPx,
      left: VIEW_W / 2 + (values.x / 100) * w - w / 2,
    }
  }, [metrics, aspect, values])

  const canEdit = rect !== null

  const update = useCallback((next: Partial<Values>) => {
    setValues((v) => ({
      x:   next.x   !== undefined ? clamp(round(next.x),   LIMITS.x.min,   LIMITS.x.max)   : v.x,
      y:   next.y   !== undefined ? clamp(round(next.y),   LIMITS.y.min,   LIMITS.y.max)   : v.y,
      len: next.len !== undefined ? clamp(round(next.len), LIMITS.len.min, LIMITS.len.max) : v.len,
    }))
    setDirty(true)
  }, [])

  // One gesture at a time. Start values are captured at pointer-down so the garment tracks the
  // cursor 1:1 instead of accelerating as deltas compound.
  const dragRef = useRef<
    | { kind: 'move'; px: number; py: number; start: Values; widthPx: number }
    | { kind: 'scale'; startDist: number; start: Values; centerX: number; centerY: number }
    | null
  >(null)

  const beginMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rect) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { kind: 'move', px: e.clientX, py: e.clientY, start: values, widthPx: rect.w }
  }

  /**
   * Corner scale, same feel as the 3D editor's handles: the pointer's distance from the garment
   * centre drives the scale ratio. Scaling is about the CENTRE, so x/y are re-derived to hold the
   * centre still — otherwise the garment would creep down-right as it grew (the layout anchors on
   * the top edge and on a fraction of the garment's own width).
   */
  const beginScale = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rect) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box) return
    const centerX = rect.left + rect.w / 2
    const centerY = rect.top + rect.h / 2
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    dragRef.current = {
      kind: 'scale',
      startDist: Math.hypot(px - centerX, py - centerY) || 1,
      start: values,
      centerX,
      centerY,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || !metrics) return

    if (d.kind === 'move') {
      update({
        x: d.start.x + ((e.clientX - d.px) / d.widthPx) * 100,
        y: d.start.y + ((e.clientY - d.py) / metrics.userHeightPx) * 100,
      })
      return
    }

    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box) return
    const dist = Math.hypot(e.clientX - box.left - d.centerX, e.clientY - box.top - d.centerY)
    const k = dist / d.startDist
    if (!Number.isFinite(k) || k <= 0) return
    const len = clamp(d.start.len * k, LIMITS.len.min, LIMITS.len.max)
    // Re-derive x/y from the actual applied length so hitting a clamp doesn't drift the centre.
    const kApplied = len / d.start.len
    const newH = metrics.pxPerCm * len
    update({
      len,
      x: d.start.x / kApplied,
      y: ((d.centerY - newH / 2) - metrics.globalTopOffsetPx - metrics.chinOffsetPx) / metrics.userHeightPx * 100,
    })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  // Arrow keys nudge, Shift = larger step — same interaction as the 3D mesh editor.
  const garmentWidthPx = rect?.w ?? null
  useEffect(() => {
    if (!open || !metrics || !garmentWidthPx) return
    const onKey = (e: KeyboardEvent) => {
      const stepPx = e.shiftKey ? 10 : 2
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft') dx = -stepPx
      else if (e.key === 'ArrowRight') dx = stepPx
      else if (e.key === 'ArrowUp') dy = -stepPx
      else if (e.key === 'ArrowDown') dy = stepPx
      else return
      e.preventDefault()
      setValues((v) => {
        setDirty(true)
        return {
          ...v,
          x: clamp(round(v.x + (dx / garmentWidthPx) * 100), LIMITS.x.min, LIMITS.x.max),
          y: clamp(round(v.y + (dy / metrics.userHeightPx) * 100), LIMITS.y.min, LIMITS.y.max),
        }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, metrics, garmentWidthPx])

  const handleSave = async () => {
    if (!product) return
    setSaving(true)
    setError(null)
    try {
      await v2Api.savePlacement2DForProduct(product.id, {
        placement_x: values.x,
        placement_y: values.y,
        image_length: values.len,
      })
      setDirty(false)
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save placement')
    } finally {
      setSaving(false)
    }
  }

  if (!product) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[560px] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-sm">
            2D placement · {product.product_name ?? product.id.slice(0, 8)}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-[10px] text-muted-foreground">
              Drag to move · corners scale · arrow keys nudge (Shift = bigger) · {zone} on the {gender} avatar
            </p>
            <button
              onClick={() => { setValues(seed); setDirty(false) }}
              className="flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>

          <div
            className="relative self-center overflow-hidden rounded-lg border border-border bg-white"
            style={{ width: VIEW_W, height: VIEW_H }}
          >
            {mannequinConfig && product.image_url ? (
              <>
                <AvatarRenderer
                  mannequinConfig={mannequinConfig}
                  items={items}
                  gender={gender}
                  containerWidth={VIEW_W}
                  containerHeight={VIEW_H}
                  placementMode="2d"
                  onMetrics={handleMetrics}
                />
                {/* Interaction surface: drag anywhere to move, corners to scale. The gizmo only
                    shows while the cursor is over the canvas, so the garment reads cleanly. */}
                <div
                  ref={surfaceRef}
                  className={`absolute inset-0 ${canEdit ? 'cursor-move' : 'cursor-default'}`}
                  onPointerDown={beginMove}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onMouseEnter={() => setHovering(true)}
                  onMouseLeave={() => setHovering(false)}
                >
                  {rect && hovering && (
                    <div
                      className="pointer-events-none absolute border border-[#2563eb]/70"
                      style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }}
                    >
                      {([
                        ['nwse-resize', { left: -6, top: -6 }],
                        ['nesw-resize', { left: rect.w - 6, top: -6 }],
                        ['nesw-resize', { left: -6, top: rect.h - 6 }],
                        ['nwse-resize', { left: rect.w - 6, top: rect.h - 6 }],
                      ] as const).map(([cursor, pos], i) => (
                        <div
                          key={i}
                          className="pointer-events-auto absolute h-3 w-3 rounded-[2px] border-[1.5px] border-[#2563eb] bg-white"
                          style={{ ...pos, cursor }}
                          onPointerDown={beginScale}
                          onPointerMove={onPointerMove}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                {mannequinLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {product.image_url ? 'Mannequin unavailable.' : 'No garment image available.'}
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="px-1 text-center font-mono text-[10.5px] text-muted-foreground">
            x {values.x}% · y {values.y}% · {values.len} cm
          </p>

          {error && <p className="px-1 text-[11px] text-destructive">{error}</p>}
        </div>

        <DialogFooter className="shrink-0">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button size="sm" disabled={!dirty || saving || !product.image_url} onClick={handleSave}>
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Save 2D placement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
