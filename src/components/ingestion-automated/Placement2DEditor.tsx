import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
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

function Row({ label, unit, value, min, max, step, onChange }: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10.5px] text-muted-foreground">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
      />
      <Input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(clamp(n, min, max))
        }}
        className="h-6 w-16 px-1.5 text-[10.5px]"
      />
      <span className="w-6 shrink-0 text-[10px] text-muted-foreground">{unit}</span>
    </div>
  )
}

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
 * Saves only those three columns. The 3D `placement` map is never read or written here.
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

  // Rendered garment width in px, which placement_x is measured against.
  const garmentWidthPx = metrics && aspect ? metrics.pxPerCm * values.len * aspect : null
  const canDrag = Boolean(metrics && garmentWidthPx)

  const update = useCallback((next: Partial<Values>) => {
    setValues((v) => ({
      x:   next.x   !== undefined ? clamp(round(next.x),   LIMITS.x.min,   LIMITS.x.max)   : v.x,
      y:   next.y   !== undefined ? clamp(round(next.y),   LIMITS.y.min,   LIMITS.y.max)   : v.y,
      len: next.len !== undefined ? clamp(round(next.len), LIMITS.len.min, LIMITS.len.max) : v.len,
    }))
    setDirty(true)
  }, [])

  // Drag on the avatar → placement_x / placement_y. Values are captured at pointer-down so the
  // garment tracks the cursor 1:1 instead of accelerating as the deltas compound.
  const dragRef = useRef<{ px: number; py: number; start: Values; widthPx: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canDrag || !garmentWidthPx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, start: values, widthPx: garmentWidthPx }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || !metrics) return
    update({
      x: d.start.x + ((e.clientX - d.px) / d.widthPx) * 100,
      y: d.start.y + ((e.clientY - d.py) / metrics.userHeightPx) * 100,
    })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  // Arrow keys nudge, Shift = larger step — same interaction as the 3D mesh editor.
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
              Drag the garment to position · arrow keys nudge (Shift = bigger) · {zone} on the {gender} avatar
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
                {/* Transparent drag surface over the avatar. */}
                <div
                  className={`absolute inset-0 ${canDrag ? 'cursor-move' : 'cursor-default'}`}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
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

          <div className="flex flex-col gap-2 px-1">
            <Row label="X" unit="%" value={values.x} min={LIMITS.x.min} max={LIMITS.x.max} step={0.5}
              onChange={(v) => update({ x: v })} />
            <Row label="Y" unit="%" value={values.y} min={LIMITS.y.min} max={LIMITS.y.max} step={0.5}
              onChange={(v) => update({ y: v })} />
            <Row label="Length" unit="cm" value={values.len} min={LIMITS.len.min} max={LIMITS.len.max} step={0.5}
              onChange={(v) => update({ len: v })} />
          </div>

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
