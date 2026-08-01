import { useEffect, useRef, useState } from "react"
import { Application, Assets, Container, MeshPlane, Sprite, Texture } from "pixi.js"
import type { StudioRenderedItem, StudioRenderedZone } from "@/features/studio/types"
import { mannequinAssetUrl } from "@/components/ingestion-automated/PlacementMeshEditor"
import { headCropRect } from "@/features/studio/constants/mannequinAnchors"
import { recolorHair, recolorSkin } from "@/features/studio/utils/recolor"

// Fixed placement canvas — identical to the mesh editor / Modal placement engine
// (services/test_placement/pipeline/camera_registration.py :: standardize_to_canvas). Rendering in
// the same world space is what makes a saved placement land 1:1 here.
const CANVAS_W = 1800
const CANVAS_H = 3072
const MESH_X = 8
const MESH_Y = 11
const ALPHA_CUTOFF = 12
const BOUNDS_SAMPLE = 256

type Bounds = { x: number; y: number; w: number; h: number }

// Layer order: bottoms sit behind tops; shoes at the base. Higher z draws later (on top).
const ZONE_Z: Record<StudioRenderedZone, number> = { shoes: 0, bottom: 1, top: 2 }

/** Opaque bounding box of a mostly-transparent garment PNG (same probe as the editor). */
async function probeGarmentBounds(url: string, texW: number, texH: number): Promise<Bounds> {
  const fallback: Bounds = { x: 0, y: 0, w: texW, h: texH }
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, BOUNDS_SAMPLE / Math.max(img.width, img.height))
    const cw = Math.max(1, Math.round(img.width * scale))
    const ch = Math.max(1, Math.round(img.height * scale))
    const ctx = draw(img, cw, ch)
    if (!ctx) return fallback
    const { data } = ctx.getImageData(0, 0, cw, ch)
    let minX = cw, minY = ch, maxX = -1, maxY = -1
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] <= ALPHA_CUTOFF) continue
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) return fallback
    const inv = 1 / scale
    const pad = inv
    const bx = Math.max(0, minX * inv - pad)
    const by = Math.max(0, minY * inv - pad)
    return {
      x: bx, y: by,
      w: Math.min(texW - bx, (maxX - minX + 1) * inv + pad * 2),
      h: Math.min(texH - by, (maxY - minY + 1) * inv + pad * 2),
    }
  } catch {
    return fallback
  }
}

/**
 * Density-based figure bounds of the mannequin frame (same probe as the editor). Both mannequins are
 * transparent-backed now, so alpha alone would do; the near-white test is kept as free insurance
 * against an asset that ships on white again.
 */
async function probeMannequinBounds(url: string, texW: number, texH: number): Promise<Bounds> {
  const fallback: Bounds = { x: 0, y: 0, w: texW, h: texH }
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, BOUNDS_SAMPLE / Math.max(img.width, img.height))
    const cw = Math.max(1, Math.round(img.width * scale))
    const ch = Math.max(1, Math.round(img.height * scale))
    const ctx = draw(img, cw, ch)
    if (!ctx) return fallback
    const { data } = ctx.getImageData(0, 0, cw, ch)
    const rowCount = new Int32Array(ch)
    const colCount = new Int32Array(cw)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4
        const bright = (data[i] + data[i + 1] + data[i + 2]) / 3
        if (data[i + 3] <= ALPHA_CUTOFF || bright >= 245) continue
        rowCount[y]++; colCount[x]++
      }
    }
    const rowThr = cw * 0.02, colThr = ch * 0.02
    let minX = -1, maxX = -1, minY = -1, maxY = -1
    for (let y = 0; y < ch; y++) if (rowCount[y] > rowThr) { if (minY < 0) minY = y; maxY = y }
    for (let x = 0; x < cw; x++) if (colCount[x] > colThr) { if (minX < 0) minX = x; maxX = x }
    if (maxX < 0 || maxY < 0) return fallback
    const inv = 1 / scale
    const x = minX * inv, y = minY * inv
    return { x, y, w: Math.min(texW - x, (maxX - minX + 1) * inv), h: Math.min(texH - y, (maxY - minY + 1) * inv) }
  } catch {
    return fallback
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = "anonymous"
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("image load failed"))
    el.src = url
  })
}

function draw(img: HTMLImageElement, cw: number, ch: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas")
  canvas.width = cw; canvas.height = ch
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, cw, ch)
  return ctx
}

/** Where the baked photoreal hair cutouts live. Full-canvas RGBA frames, positioned by baking. */
function bakedHairAssetUrl(mannequin: "male" | "female", styleKey: string): string {
  return `/hair-baked/${mannequin}/${styleKey}.png`
}

type PlacementHairStyle = {
  /** Selects the baked cutout, e.g. 'bob'. */
  styleKey: string
  /** Which mannequin the cutout was baked against; hair is skipped on a mismatch. */
  gender: "male" | "female"
}

type Props = {
  items: StudioRenderedItem[]
  gender?: "male" | "female"
  containerHeight?: number
  containerWidth?: number
  itemOpacity?: number
  avatarRef?: React.Ref<HTMLDivElement>
  onReady?: (ready: boolean) => void
  fetchPriority?: "high" | "low" | "auto"
  /** The user's hairstyle. null renders the mannequin bald. */
  hairStyle?: PlacementHairStyle | null
  hairColorHex?: string | null
  /** Position on the melanin axis (see shared/skin/melanin). null keeps the photograph as shot. */
  skinTone?: number | null
  /**
   * 'figure' (default) frames the whole body. 'head' frames head-and-shoulders, for pickers where
   * the face is what's being chosen and a full figure would render the detail too small.
   */
  crop?: "figure" | "head"
}

/**
 * Read-only studio renderer that composites the 1800x3072 placement mannequin + each garment via
 * its saved affine transform + warp lattice — the exact output of the mesh editor / Modal engine.
 * Only items carrying a `.placement` are drawn; the caller decides when to use this vs the legacy
 * SVG AvatarRenderer.
 *
 * Also carries the user's identity — hairstyle, hair colour and skin tone. Those were previously
 * honoured only by the legacy SVG avatar, so switching an outfit to this renderer silently dropped
 * all three.
 */
export function PlacementAvatarRenderer({
  items,
  gender = "female",
  containerHeight = 460,
  containerWidth = 320,
  itemOpacity = 1,
  avatarRef,
  onReady,
  hairStyle = null,
  hairColorHex = null,
  skinTone = null,
  crop = "figure",
}: Props) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const appRef = useRef<Application | null>(null)

  /**
   * The mannequin to draw: the VIEWER'S, whenever any garment can be rendered on it.
   *
   * This used to follow the garment — whichever body it happened to be placed on — so a unisex item
   * showed everyone the same mannequin regardless of their own gender. The viewer wins now.
   *
   * The fallback matters: a product placed on only one mannequin (older rows, or a runner-up
   * registration that failed the acceptance bar) still renders on that one rather than vanishing.
   * That is today's behaviour, and it retires product-by-product as the backfill lands.
   */
  const mannequin: "male" | "female" =
    items.some((it) => it.placement?.[gender] && it.imageUrl)
      ? gender
      : items.find((it) => it.placement && it.imageUrl)?.placement?.male
        ? "male"
        : items.some((it) => it.placement?.female && it.imageUrl)
          ? "female"
          : gender

  // Garments renderable on THAT mannequin, back-to-front (shoes → bottom → top).
  const placed = items
    .filter((it) => it.placement?.[mannequin] && it.imageUrl)
    .sort((a, b) => (ZONE_Z[a.zone] ?? 0) - (ZONE_Z[b.zone] ?? 0))
  // Stable signature so the effect re-runs when the outfit / transforms change.
  const sig = placed
    .map((it) => `${it.id}:${it.imageUrl}:${JSON.stringify(it.placement?.[mannequin])}`)
    .join("|") +
    `#${mannequin}#${containerWidth}x${containerHeight}#${crop}` +
    `#${hairStyle?.styleKey ?? "bald"}:${hairStyle?.gender ?? ""}#${hairColorHex ?? ""}` +
    `#${skinTone == null ? "" : skinTone.toFixed(4)}`

  useEffect(() => {
    if (!host) return
    let disposed = false
    onReady?.(false)
    const app = new Application()

    ;(async () => {
      try {
        await app.init({
          width: containerWidth,
          height: containerHeight,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        })
        if (disposed) { app.destroy(true); return }
        appRef.current = app
        host.appendChild(app.canvas)

        const mannequinUrl = mannequinAssetUrl(mannequin)
        // Loaded via loadImage rather than Assets.load because the skin retone needs CPU-side pixel
        // access, which a GPU texture does not give.
        const mannequinImg = await loadImage(mannequinUrl)
        if (disposed) return
        const mannequinSource = skinTone == null
          ? mannequinImg
          : recolorSkin(mannequinImg, skinTone) ?? mannequinImg
        const mannequinTex = Texture.from(mannequinSource)

        const world = new Container()
        app.stage.addChild(world)

        const base = new Sprite(mannequinTex)
        base.width = CANVAS_W
        base.height = CANVAS_H
        world.addChild(base)

        // Hair sits over the mannequin but UNDER the garments, so a collar can occlude it. The
        // cutout is a full-canvas frame with the hair already in position, so it draws at the origin
        // — there is no positioning maths.
        if (hairStyle && hairStyle.gender === mannequin) {
          try {
            const hairImg = await loadImage(bakedHairAssetUrl(mannequin, hairStyle.styleKey))
            if (disposed) return
            const source = hairColorHex ? recolorHair(hairImg, hairColorHex) ?? hairImg : hairImg
            const hair = new Sprite(Texture.from(source))
            hair.width = CANVAS_W
            hair.height = CANVAS_H
            world.addChild(hair)
          } catch {
            // A missing cutout must render a bald mannequin, never break the whole avatar.
          }
        }

        // Frame either the whole figure or a head-and-shoulders crop.
        const mb = crop === "head"
          ? headCropRect(mannequin)
          : await probeMannequinBounds(mannequinUrl, CANVAS_W, CANVAS_H)
        if (disposed) return
        const displayScale = Math.min(containerWidth / mb.w, containerHeight / mb.h)
        world.scale.set(displayScale)
        world.position.set(
          containerWidth / 2 - (mb.x + mb.w / 2) * displayScale,
          containerHeight / 2 - (mb.y + mb.h / 2) * displayScale,
        )

        // Each garment: replicate the editor's fit/home/pivot, then apply transform + warp.
        for (const item of placed) {
          const t = item.placement![mannequin]!
          const tex = (await Assets.load(item.imageUrl)) as Texture
          if (disposed) return
          const texW = tex.width
          const texH = tex.height
          const fit = Math.min(CANVAS_W / texW, CANVAS_H / texH)

          const gb = await probeGarmentBounds(item.imageUrl, texW, texH)
          if (disposed) return

          const mesh = new MeshPlane({ texture: tex, verticesX: MESH_X, verticesY: MESH_Y })
          mesh.position.set(-texW / 2, -texH / 2)

          // Apply the saved warp lattice (base vertices + per-vertex offsets).
          if (t.warp && t.warp.length) {
            const buf = mesh.geometry.getBuffer("aPosition")
            const pos = buf.data as Float32Array
            const n = Math.min(t.warp.length, pos.length / 2)
            for (let i = 0; i < n; i++) {
              pos[i * 2] += t.warp[i].x
              pos[i * 2 + 1] += t.warp[i].y
            }
            buf.update()
          }

          const garment = new Container()
          garment.addChild(mesh)
          garment.alpha = itemOpacity

          const pivotX = gb.x + gb.w / 2 - texW / 2
          const pivotY = gb.y + gb.h / 2 - texH / 2
          garment.pivot.set(pivotX, pivotY)

          const home = { x: CANVAS_W / 2 + pivotX * fit, y: CANVAS_H / 2 + pivotY * fit }
          garment.position.set(home.x + t.tx, home.y + t.ty)
          garment.scale.set(fit * t.scale)
          garment.rotation = (t.rotationDeg * Math.PI) / 180

          world.addChild(garment)
        }

        onReady?.(true)
      } catch {
        if (!disposed) onReady?.(true) // don't wedge the studio on a placement render error
      }
    })()

    return () => {
      disposed = true
      appRef.current = null
      try { app.destroy(true, { children: true }) } catch { /* already torn down */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, host])

  return (
    <div
      ref={avatarRef}
      className="relative"
      style={{ width: containerWidth, height: containerHeight }}
    >
      <div ref={setHost} className="absolute inset-0" />
    </div>
  )
}
