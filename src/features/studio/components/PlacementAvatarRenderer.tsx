import { useEffect, useRef, useState } from "react"
import { Application, Assets, Container, MeshPlane, Sprite, Texture } from "pixi.js"
import type { StudioRenderedItem, StudioRenderedZone } from "@/features/studio/types"
import { mannequinAssetUrl } from "@/components/ingestion-automated/PlacementMeshEditor"
import { PLACEMENT_HEAD_ANCHOR, headCropRect } from "@/features/studio/constants/mannequinAnchors"
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

/**
 * Open the top of a figure frame so hair isn't sliced off at the crown.
 *
 * probeMannequinBounds reads the BARE mannequin, so its top edge is the top of
 * the bald skull. The baked hair cutout is composited over it as a separate
 * full-canvas sprite and contributes nothing to those bounds — so every style
 * that rises above the crown (which is most of them) got a flat cut across the
 * top. Invisible while the avatar was a 64px circle; obvious the moment it is
 * rendered large.
 *
 * The allowance is the same one headCropRect already applies for the same
 * reason: 55% of head height above the crown, clamped to the canvas. Only added
 * when hair actually drew, or a bald figure would float under dead space.
 */
function withHairHeadroom(bounds: Bounds, mannequin: "male" | "female", hairDrawn: boolean): Bounds {
  if (!hairDrawn) return bounds
  const a = PLACEMENT_HEAD_ANCHOR[mannequin]
  const top = Math.max(0, bounds.y - (a.chin - a.top) * 0.55)
  return { x: bounds.x, y: top, w: bounds.w, h: bounds.h + (bounds.y - top) }
}

/**
 * Opaque bounding box AND a point-in-cloth test for a mostly-transparent
 * garment PNG (same probe as the editor).
 *
 * The mask matters as much as the bounds. A garment mesh spans the whole padded
 * 1800x3072 frame, so every garment's *rectangular* hit area covers the entire
 * figure — tap the trousers and the topmost sprite (the shirt) answers, because
 * it was added last. `isOpaque` lets the hit test ask whether there is actually
 * cloth under the finger. Same single alpha pass; the mask was already being
 * computed and thrown away.
 */
type GarmentProbe = {
  bounds: Bounds
  /** Texture-space coords, in the ORIGINAL (unpadded-scale) pixel grid. */
  isOpaque: (texX: number, texY: number) => boolean
}

async function probeGarment(url: string, texW: number, texH: number): Promise<GarmentProbe> {
  const fallback: GarmentProbe = {
    bounds: { x: 0, y: 0, w: texW, h: texH },
    // Rectangular fallback — the current behaviour, used only when the pixels
    // can't be read (a cross-origin image without CORS headers, say).
    isOpaque: () => true,
  }
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, BOUNDS_SAMPLE / Math.max(img.width, img.height))
    const cw = Math.max(1, Math.round(img.width * scale))
    const ch = Math.max(1, Math.round(img.height * scale))
    const ctx = draw(img, cw, ch)
    if (!ctx) return fallback
    const { data } = ctx.getImageData(0, 0, cw, ch)
    const mask = new Uint8Array(cw * ch)
    let minX = cw, minY = ch, maxX = -1, maxY = -1
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] <= ALPHA_CUTOFF) continue
        mask[y * cw + x] = 1
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) return fallback
    const inv = 1 / scale
    const pad = inv
    const bx = Math.max(0, minX * inv - pad)
    const by = Math.max(0, minY * inv - pad)

    // The mask is sampled at ~256px, so one sample is several texture pixels
    // wide. Accept a hit within one sample of real cloth: a tap that lands on a
    // sleeve edge or between the legs of a print should still count, and a
    // near-miss is far less annoying than selecting the wrong garment.
    const isOpaque = (texX: number, texY: number) => {
      const sx = Math.round((texX / texW) * cw)
      const sy = Math.round((texY / texH) * ch)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = sx + dx
          const y = sy + dy
          if (x < 0 || y < 0 || x >= cw || y >= ch) continue
          if (mask[y * cw + x]) return true
        }
      }
      return false
    }

    return {
      bounds: {
        x: bx, y: by,
        w: Math.min(texW - bx, (maxX - minX + 1) * inv + pad * 2),
        h: Math.min(texH - by, (maxY - minY + 1) * inv + pad * 2),
      },
      isOpaque,
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

/**
 * Where the baked photoreal hair cutouts live. Full-canvas RGBA frames, positioned by baking.
 *
 * WebP, re-encoded from the PNG masters kept alongside them. recolorHair normalises against a
 * percentile-trimmed luminance histogram of these pixels, so that range was checked across all
 * twelve cutouts before the swap: worst drift 2 of 255, opaque pixel count unchanged. 2.4MB → 273KB.
 */
function bakedHairAssetUrl(mannequin: "male" | "female", styleKey: string): string {
  return `/hair-baked/${mannequin}/${styleKey}.webp`
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
  /**
   * Tap handler per garment. Omit to keep the surface read-only, which is what the studio wants —
   * passing it turns on PIXI hit testing against each garment's real mesh geometry, so taps land on
   * the garment shape rather than its bounding box.
   */
  onItemSelect?: (item: StudioRenderedItem) => void
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
  onItemSelect,
}: Props) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const appRef = useRef<Application | null>(null)

  // The scene is rebuilt only when `sig` changes, so a handler captured while building it would go
  // stale against anything the caller closes over. Held in a ref and called through, which keeps the
  // tap current without rebuilding every garment on each render.
  const onItemSelectRef = useRef(onItemSelect)
  onItemSelectRef.current = onItemSelect

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
        let hairDrawn = false
        if (hairStyle && hairStyle.gender === mannequin) {
          try {
            const hairImg = await loadImage(bakedHairAssetUrl(mannequin, hairStyle.styleKey))
            if (disposed) return
            const source = hairColorHex ? recolorHair(hairImg, hairColorHex) ?? hairImg : hairImg
            const hair = new Sprite(Texture.from(source))
            hair.width = CANVAS_W
            hair.height = CANVAS_H
            world.addChild(hair)
            hairDrawn = true
          } catch {
            // A missing cutout must render a bald mannequin, never break the whole avatar.
          }
        }

        // Frame either the whole figure or a head-and-shoulders crop.
        const mb = crop === "head"
          ? headCropRect(mannequin)
          : withHairHeadroom(
              await probeMannequinBounds(mannequinUrl, CANVAS_W, CANVAS_H),
              mannequin,
              hairDrawn,
            )
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

          const { bounds: gb, isOpaque } = await probeGarment(item.imageUrl, texW, texH)
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

          // Opt-in hit testing. This renderer is read-only for the studio, so interactivity stays
          // off unless a caller asks; enabling it everywhere would add cost to surfaces that never
          // use it.
          //
          // Read through the ref, not the prop: the scene is only rebuilt when
          // `sig` changes, so a caller that starts with no handler and supplies
          // one later (auth resolving, view-only clearing) would otherwise leave
          // every garment permanently non-interactive.
          //
          // hitArea is NOT optional here. PIXI hit-tests a mesh against its
          // bounding box — an earlier comment in this file claimed it was
          // "per-pixel-ish", which is what let the bug hide. Every garment mesh
          // spans the full padded frame, so all three bounding boxes cover the
          // whole figure and the last one added (the top, by ZONE_Z) swallowed
          // every tap: clicking the trousers selected the shirt. The mask makes
          // the test ask what is actually drawn under the point.
          if (onItemSelectRef.current) {
            garment.eventMode = "static"
            garment.cursor = "pointer"
            garment.hitArea = {
              // Local space: the mesh is laid out from (-texW/2, -texH/2), so
              // shifting by half the texture gives texture-space coords. Pivot,
              // scale and rotation are already undone by PIXI before this runs.
              contains: (x: number, y: number) => {
                const texX = x + texW / 2
                const texY = y + texH / 2
                if (texX < 0 || texY < 0 || texX >= texW || texY >= texH) return false
                return isOpaque(texX, texY)
              },
            }
            garment.on("pointertap", () => onItemSelectRef.current?.(item))
          }

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
