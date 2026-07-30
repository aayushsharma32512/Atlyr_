import { useEffect, useRef, useState, useCallback } from 'react'
import { Application, Container, Graphics, MeshPlane, Rectangle, Sprite, Texture, type PointData } from 'pixi.js'
import { RotateCcw, Undo2, Loader2, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ColumnLabel, ControlSection, NumberStepper } from './PlacementControls'
import { useToast } from '@/hooks/use-toast'
import { v2Api } from '@/utils/ingestionV2Api'
import type { PipelineJob } from '@/utils/ingestionV2Api'
import type { PlacementInfo, PlacementTransform } from './usePlacementImage'

// The placement pipeline standardizes everything onto a fixed 1800x3072 canvas
// (services/test_placement/pipeline/camera_registration.py :: standardize_to_canvas).
// The editor works in that same world space so edits map 1:1 onto the real composite.
const CANVAS_W = 1800
const CANVAS_H = 3072

// On-screen size — world space is scaled down by VIEW_H / CANVAS_H.
const VIEW_H = 460
const VIEW_W = Math.round((VIEW_H * CANVAS_W) / CANVAS_H)
// Letterbox so the full mannequin (feet included) never touches / clips at the canvas edge.
const MARGIN = 28
const VIEW_SCALE = (VIEW_H - MARGIN * 2) / CANVAS_H

// Mesh density. Every vertex that lands on the cloth is itself a drag handle, so this is also
// the handle density — keep it coarse enough to grab comfortably.
const MESH_X = 8
const MESH_Y = 11
// Gaussian falloff for a vertex drag, in units of the garment's opaque bounds. Small = local
// tweaks; the neighbours follow softly so pulls read as cloth, not spikes.
const FALLOFF = 0.18

// Alpha above this counts as garment when probing the segmented PNG.
const ALPHA_CUTOFF = 12
// Longest edge used when sampling the garment for bounds/opacity.
const BOUNDS_SAMPLE = 256

type Bounds = { x: number; y: number; w: number; h: number }

type GarmentProbe = {
  bounds: Bounds
  /** True if the texture-space point sits on opaque cloth. */
  isOpaque: (x: number, y: number) => boolean
}

type Snapshot = { x: number; y: number; scale: number; rotation: number; offsets: Float32Array }

/**
 * The saved transform, mirrored into React so the control rail can display and drive it. Units are
 * exactly the ones `handleSave` persists — canvas px for tx/ty, a multiple of the auto-fit for
 * scale, degrees for rotation — so what the panel reads is what the pipeline will get.
 */
type Xform = { tx: number; ty: number; scale: number; rotationDeg: number }

// Step sizes for the rail. tx/ty match the arrow-key STEP/BIG contract below, so a click and a
// keypress move the garment by the same amount.
const XFORM_STEPS = {
  translate: { step: 12, big: 60 },
  scale: { step: 0.02, big: 0.1 },
  rotate: { step: 0.5, big: 5 },
} as const

const SCALE_MIN = 0.1
const SCALE_MAX = 4

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** True for elements that own their keystrokes — the global key handlers must leave them alone. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

type Drag =
  | { kind: 'move'; startPtr: PointData; startPos: PointData }
  | { kind: 'scale'; startDist: number; startScale: number }
  | { kind: 'rotate'; startAngle: number; startRotation: number }
  | { kind: 'vertex'; index: number; startPtr: PointData; startOffsets: Float32Array }
  // Grab-anywhere warp: the pull centers on the pressed point (not a fixed vertex), with per-vertex
  // Gaussian weights computed from that point at pointerdown.
  | { kind: 'warpPoint'; startPtr: PointData; weights: Float32Array; startOffsets: Float32Array }
  | null

/**
 * A normalized placement source — the editor is agnostic to whether it's editing a pipeline job
 * (segmented garment) or a legacy catalog product (image_url). Both provide a garment image, the
 * mannequin to place onto, an optional prior transform to restore, and a save callback.
 */
export type PlacementEditorSource = {
  /** Stable key for the load effect (garment + mannequin). Re-inits when it changes. */
  key: string
  garmentUrl: string | null
  mannequin: 'male' | 'female'
  transform: PlacementTransform | null
  /**
   * Read-only "this is how it should fit" photo shown beside the canvas — the generated VTON
   * try-on, so the operator places against the real drape instead of from memory. Null hides the
   * column's image and shows a placeholder.
   */
  reference?: { url: string; label: string } | null
  /** Saved mesh warp to restore on open, so a re-edit continues from the deformed shape. */
  warp?: { x: number; y: number }[] | null
  onSave: (payload: { image_base64: string; transform: PlacementTransform; warp: { x: number; y: number }[] }) => Promise<void>
  /** Shown as the header subtitle (e.g. the product / job label). */
  label?: string
}

type CoreProps = {
  source: PlacementEditorSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

/** Decode an image once (CORS-enabled). Shared by the Pixi texture AND the pixel probes, so each
 *  image is decoded a single time instead of twice (Assets.load + a separate probe Image). */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error(`image load failed: ${url}`))
    el.src = url
  })
}

// The mannequin never changes for a given gender, so decode it + compute its figure bounds ONCE and
// reuse across every editor open (keyed by url). Eliminates the biggest per-open cost on reopen.
const mannequinCache = new Map<string, { img: HTMLImageElement; bounds: Bounds }>()
async function loadMannequin(url: string): Promise<{ img: HTMLImageElement; bounds: Bounds }> {
  const cached = mannequinCache.get(url)
  if (cached) return cached
  const img = await loadImage(url)
  const bounds = await probeMannequinBounds(img, CANVAS_W, CANVAS_H)
  const entry = { img, bounds }
  mannequinCache.set(url, entry)
  return entry
}

/**
 * A segmented garment PNG is mostly transparent padding. Probe its alpha once (downsampled) to
 * learn both the opaque bounding box and a point-in-cloth test, so the whole gizmo — grid,
 * vertex handles, hit area — can live on the cloth itself.
 */
async function probeGarment(img: HTMLImageElement, texW: number, texH: number): Promise<GarmentProbe> {
  const fallback: GarmentProbe = {
    bounds: { x: 0, y: 0, w: texW, h: texH },
    isOpaque: () => true,
  }
  try {
    const scale = Math.min(1, BOUNDS_SAMPLE / Math.max(img.width, img.height))
    const cw = Math.max(1, Math.round(img.width * scale))
    const ch = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return fallback
    ctx.drawImage(img, 0, 0, cw, ch)
    const { data } = ctx.getImageData(0, 0, cw, ch)

    let minX = cw, minY = ch, maxX = -1, maxY = -1
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] <= ALPHA_CUTOFF) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) return fallback // fully transparent — nothing to measure

    const inv = 1 / scale
    const pad = inv
    const bx = Math.max(0, minX * inv - pad)
    const by = Math.max(0, minY * inv - pad)
    const bounds: Bounds = {
      x: bx,
      y: by,
      w: Math.min(texW - bx, (maxX - minX + 1) * inv + pad * 2),
      h: Math.min(texH - by, (maxY - minY + 1) * inv + pad * 2),
    }

    const isOpaque = (x: number, y: number) => {
      const sx = Math.min(cw - 1, Math.max(0, Math.round(x * scale)))
      const sy = Math.min(ch - 1, Math.max(0, Math.round(y * scale)))
      return data[(sy * cw + sx) * 4 + 3] > ALPHA_CUTOFF
    }

    return { bounds, isOpaque }
  } catch {
    return fallback
  }
}

/**
 * Bounding box of the mannequin figure inside its frame (world/texture space). The base image
 * has a lot of empty margin (male: ~5% blank at top, feet at the very bottom; female: blank all
 * round), so we frame this box in the view instead of the whole 1800x3072 canvas — the figure
 * fills the canvas rather than being shrunk into a corner. Content = opaque AND not near-white,
 * so it works for both the white-bg male and the transparent female.
 */
async function probeMannequinBounds(img: HTMLImageElement, texW: number, texH: number): Promise<Bounds> {
  const fallback: Bounds = { x: 0, y: 0, w: texW, h: texH }
  try {
    const scale = Math.min(1, BOUNDS_SAMPLE / Math.max(img.width, img.height))
    const cw = Math.max(1, Math.round(img.width * scale))
    const ch = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return fallback
    ctx.drawImage(img, 0, 0, cw, ch)
    const { data } = ctx.getImageData(0, 0, cw, ch)

    // Count content per row/column, then take bounds by DENSITY — a sparse scatter of
    // near-white / edge-noise pixels (male's non-pure-white background) shouldn't widen the box.
    const rowCount = new Int32Array(ch)
    const colCount = new Int32Array(cw)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4
        const a = data[i + 3]
        const bright = (data[i] + data[i + 1] + data[i + 2]) / 3
        if (a <= ALPHA_CUTOFF || bright >= 245) continue // transparent or near-white = background
        rowCount[y]++
        colCount[x]++
      }
    }
    const rowThr = cw * 0.02
    const colThr = ch * 0.02
    let minX = -1, maxX = -1, minY = -1, maxY = -1
    for (let y = 0; y < ch; y++) if (rowCount[y] > rowThr) { if (minY < 0) minY = y; maxY = y }
    for (let x = 0; x < cw; x++) if (colCount[x] > colThr) { if (minX < 0) minX = x; maxX = x }
    if (maxX < 0 || maxY < 0) return fallback
    const inv = 1 / scale
    const x = minX * inv
    const y = minY * inv
    return { x, y, w: Math.min(texW - x, (maxX - minX + 1) * inv), h: Math.min(texH - y, (maxY - minY + 1) * inv) }
  } catch {
    return fallback
  }
}

/** Placement mannequin base image for a normalized gender. */
export function mannequinAssetUrl(mannequin: 'male' | 'female'): string {
  return `/mannequins/${mannequin}.png`
}

function normalizeMannequin(picked: string | null | undefined, gender: string | null | undefined): 'male' | 'female' {
  const p = picked?.toLowerCase()
  if (p === 'male' || p === 'female') return p
  return gender === 'male' ? 'male' : 'female'
}

/**
 * Source-agnostic mesh placement editor. Renders the 1800x3072 mannequin + a warpable garment mesh
 * and saves the affine transform + warp lattice via source.onSave.
 */
function PlacementMeshEditorCore({ source, open, onOpenChange, onSaved }: CoreProps) {
  // Callback ref, not useRef: this div lives inside a Radix portal, so on the render where
  // `open` flips true the node may not be attached yet when the effect fires. Driving the
  // effect off state guarantees we initialise exactly when the node actually exists.
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const appRef = useRef<Application | null>(null)
  const worldRef = useRef<Container | null>(null)
  const meshRef = useRef<MeshPlane | null>(null)
  const garmentRef = useRef<Container | null>(null)
  const gizmoRef = useRef<Container | null>(null)

  // Everything below lives in *geometry space* (0..texW, 0..texH): the mesh is never scaled
  // directly — the fit-to-canvas factor and user scaling live on the `garment` container — so
  // vertex positions, handles and pointer deltas share one coordinate space.
  const baseVertsRef = useRef<Float32Array | null>(null)
  // Per-vertex warp displacement, applied on top of base vertices.
  const vertOffsetsRef = useRef<Float32Array | null>(null)
  // Which vertices sit on opaque cloth — only those get drawn and get a drag handle.
  const onClothRef = useRef<boolean[]>([])
  // Pairwise drag influence: weightsRef[i * vCount + j] = how much dragging vertex j moves i.
  const weightsRef = useRef<Float32Array | null>(null)
  const boundsRef = useRef<Bounds>({ x: 0, y: 0, w: 1, h: 1 })
  // Where the pipeline's own standardize-to-canvas puts the garment; stored transforms are
  // offsets from here rather than from the canvas centre, so the cloth-centre pivot cancels out.
  const homeRef = useRef<PointData>({ x: CANVAS_W / 2, y: CANVAS_H / 2 })
  const fitRef = useRef(1)
  // Actual on-screen scale applied to the world (frames the mannequin, not the full canvas).
  const viewScaleRef = useRef(VIEW_SCALE)
  const dragRef = useRef<Drag>(null)
  // Rotation-handle position + grab radius in geometry space, refreshed each drawGizmo. The grab is
  // detected at the stage level (below) rather than via the tiny per-frame-recreated handle graphic,
  // which was unreliable to click.
  const rotHandleRef = useRef<{ x: number; y: number; r: number } | null>(null)
  // Undo history — one snapshot per gesture (captured at pointerdown, before the change).
  const historyRef = useRef<Snapshot[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  // React mirror of the Pixi transform, for the control rail to read. Everything else stays in
  // refs so dragging never re-renders React.
  const [xform, setXform] = useState<Xform>({ tx: 0, ty: 0, scale: 1, rotationDeg: 0 })
  const syncFrameRef = useRef<number | null>(null)
  const { toast } = useToast()

  const garmentUrl = source?.garmentUrl ?? null
  const mannequin = source?.mannequin ?? 'female'
  const transform = source?.transform ?? null
  const savedWarp = source?.warp ?? null
  const reference = source?.reference ?? null

  /**
   * Push the garment's live transform into React for the rail to display.
   *
   * Coalesced onto one animation frame: this is called from the same places as setDirty, including
   * the per-move pointer handler, and a setState per pointer event would re-render the panel far
   * more often than the screen updates.
   *
   * The four expressions MUST stay identical to the ones in handleSave — the whole point of the
   * readout is that it shows the numbers that would actually be persisted.
   */
  const syncXform = useCallback(() => {
    if (syncFrameRef.current !== null) return
    syncFrameRef.current = requestAnimationFrame(() => {
      syncFrameRef.current = null
      const g = garmentRef.current
      if (!g) return
      setXform({
        tx: g.x - homeRef.current.x,
        ty: g.y - homeRef.current.y,
        scale: g.scale.x / (fitRef.current || 1),
        rotationDeg: (g.rotation * 180) / Math.PI,
      })
    })
  }, [])

  useEffect(() => () => {
    if (syncFrameRef.current !== null) cancelAnimationFrame(syncFrameRef.current)
    syncFrameRef.current = null
  }, [])

  // Snapshot the current garment transform + warp before a gesture, so Undo can restore it.
  const pushHistory = useCallback(() => {
    const g = garmentRef.current
    const o = vertOffsetsRef.current
    if (!g || !o) return
    historyRef.current.push({ x: g.x, y: g.y, scale: g.scale.x, rotation: g.rotation, offsets: new Float32Array(o) })
    if (historyRef.current.length > 50) historyRef.current.shift()
    setCanUndo(true)
  }, [])

  const undo = useCallback(() => {
    const snap = historyRef.current.pop()
    const g = garmentRef.current
    const o = vertOffsetsRef.current
    if (!snap || !g || !o) return
    g.position.set(snap.x, snap.y)
    g.scale.set(snap.scale)
    g.rotation = snap.rotation
    o.set(snap.offsets)
    applyWarp()
    drawGizmo()
    syncXform()
    setCanUndo(historyRef.current.length > 0)
    setDirty(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyWarp = useCallback(() => {
    const mesh = meshRef.current
    const base = baseVertsRef.current
    const offsets = vertOffsetsRef.current
    if (!mesh || !base || !offsets) return

    const buf = mesh.geometry.getBuffer('aPosition')
    const pos = buf.data as Float32Array
    for (let i = 0; i < base.length; i++) pos[i] = base[i] + offsets[i]
    buf.update()
  }, [])

  const drawGizmo = useCallback(() => {
    const gizmo = gizmoRef.current
    const garment = garmentRef.current
    const mesh = meshRef.current
    const base = baseVertsRef.current
    const offsets = vertOffsetsRef.current
    if (!gizmo || !garment || !mesh || !base || !offsets) return

    // Gizmo is a child of the mesh, so it draws in geometry space. Counter-scale by the chain
    // above it so handles keep a constant on-screen size at any garment scale.
    const inv = 1 / (garment.scale.x * viewScaleRef.current || 1)
    const r = 6 * inv
    const lw = 1.5 * inv
    const hit = 20 * inv

    gizmo.removeChildren()

    const onCloth = onClothRef.current
    const px = (i: number) => base[i * 2] + offsets[i * 2]
    const py = (i: number) => base[i * 2 + 1] + offsets[i * 2 + 1]

    // Wireframe — grid segments where both endpoints are on cloth, so the grid traces the
    // garment's silhouette and deforms live with it. This is the "mesh feeling".
    const wire = new Graphics()
    for (let gy = 0; gy < MESH_Y; gy++) {
      for (let gx = 0; gx < MESH_X; gx++) {
        const i = gy * MESH_X + gx
        if (!onCloth[i]) continue
        if (gx + 1 < MESH_X && onCloth[i + 1]) {
          wire.moveTo(px(i), py(i)).lineTo(px(i + 1), py(i + 1))
        }
        if (gy + 1 < MESH_Y && onCloth[i + MESH_X]) {
          wire.moveTo(px(i), py(i)).lineTo(px(i + MESH_X), py(i + MESH_X))
        }
      }
    }
    wire.stroke({ width: lw, color: 0x2563eb, alpha: 0.45 })
    gizmo.addChild(wire)

    // A draggable dot on every cloth vertex.
    for (let i = 0; i < onCloth.length; i++) {
      if (!onCloth[i]) continue
      const cx = px(i)
      const cy = py(i)
      const moved = offsets[i * 2] !== 0 || offsets[i * 2 + 1] !== 0
      const dot = new Graphics()
      dot.circle(cx, cy, r * 0.62).fill(moved ? 0xf97316 : 0xffffff).stroke({ width: lw, color: 0x2563eb })
      dot.eventMode = 'static'
      dot.cursor = 'move'
      dot.hitArea = { contains: (qx: number, qy: number) => Math.hypot(qx - cx, qy - cy) < hit }
      dot.on('pointerdown', (e) => {
        e.stopPropagation()
        pushHistory()
        dragRef.current = {
          kind: 'vertex',
          index: i,
          startPtr: mesh.toLocal(e.global),
          startOffsets: new Float32Array(vertOffsetsRef.current!),
        }
      })
      gizmo.addChild(dot)
    }

    // Whole-garment gizmo, anchored to the cloth bounds: corner scale + rotate.
    const b = boundsRef.current
    const midX = b.x + b.w / 2
    const corners = [
      { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
      { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h },
    ]
    for (const c of corners) {
      const g = new Graphics()
      g.rect(c.x - r, c.y - r, r * 2, r * 2).fill(0xffffff).stroke({ width: lw, color: 0x2563eb })
      g.eventMode = 'static'
      g.cursor = 'nwse-resize'
      g.hitArea = { contains: (qx: number, qy: number) => Math.abs(qx - c.x) < hit && Math.abs(qy - c.y) < hit }
      g.on('pointerdown', (e) => {
        e.stopPropagation()
        pushHistory()
        const p = garment.parent.toLocal(e.global)
        dragRef.current = {
          kind: 'scale',
          startDist: Math.hypot(p.x - garment.x, p.y - garment.y) || 1,
          startScale: garment.scale.x,
        }
      })
      gizmo.addChild(g)
    }

    const rotY = b.y - 46 * inv
    const stem = new Graphics()
    stem.moveTo(midX, b.y).lineTo(midX, rotY).stroke({ width: lw, color: 0x2563eb, alpha: 0.9 })
    gizmo.addChild(stem)

    // Purely visual — the grab is handled at the stage level via rotHandleRef (reliable clicking).
    const rot = new Graphics()
    rot.circle(midX, rotY, r * 1.15).fill(0x2563eb).stroke({ width: lw, color: 0xffffff })
    rot.eventMode = 'none'
    gizmo.addChild(rot)

    // Record the handle's grab region (geometry space) so the stage pointerdown can catch it. Kept
    // below the ~46*inv gap to the cloth-top vertex dots so it never steals their clicks.
    rotHandleRef.current = { x: midX, y: rotY, r: hit * 1.5 }
  }, [])

  /**
   * The control rail's single write path into Pixi.
   *
   * Safe by construction: the container's pivot is already the cloth centre (see the init effect),
   * and the corner-scale / rotate drags likewise write only `scale` / `rotation` with no positional
   * compensation — so a typed value pivots exactly where a dragged one does. Warp offsets are never
   * touched here, which is why applyWarp isn't called.
   *
   * `history: false` suppresses the undo snapshot for auto-repeat ticks, so press-and-hold on a
   * stepper collapses into the one entry taken when the button went down.
   */
  const applyXform = useCallback((patch: Partial<Xform>, opts?: { history?: boolean }) => {
    const g = garmentRef.current
    if (!g) return
    if (opts?.history !== false) pushHistory()
    if (patch.tx !== undefined) g.x = homeRef.current.x + clampNum(patch.tx, -CANVAS_W, CANVAS_W)
    if (patch.ty !== undefined) g.y = homeRef.current.y + clampNum(patch.ty, -CANVAS_H, CANVAS_H)
    if (patch.scale !== undefined) g.scale.set(fitRef.current * clampNum(patch.scale, SCALE_MIN, SCALE_MAX))
    if (patch.rotationDeg !== undefined) g.rotation = (clampNum(patch.rotationDeg, -180, 180) * Math.PI) / 180
    setDirty(true)
    drawGizmo()
    syncXform()
  }, [pushHistory, drawGizmo, syncXform])

  const resetAll = useCallback(() => {
    const garment = garmentRef.current
    if (!garment) return
    const t = transform
    const home = homeRef.current
    garment.position.set(home.x + (t?.tx ?? 0), home.y + (t?.ty ?? 0))
    garment.scale.set(fitRef.current * (t?.scale ?? 1))
    garment.rotation = ((t?.rotationDeg ?? 0) * Math.PI) / 180
    vertOffsetsRef.current?.fill(0)
    historyRef.current = []
    setCanUndo(false)
    applyWarp()
    drawGizmo()
    syncXform()
    setDirty(false)
  }, [transform, applyWarp, drawGizmo, syncXform])

  const handleSave = useCallback(async () => {
    const app = appRef.current
    const world = worldRef.current
    const garment = garmentRef.current
    const gizmo = gizmoRef.current
    const offsets = vertOffsetsRef.current
    if (!app || !world || !garment || !gizmo || !offsets || !source) return

    setSaving(true)
    try {
      // Render the composite without the editing overlay, at full canvas resolution.
      gizmo.visible = false
      const prevScale = world.scale.x
      world.scale.set(1)
      const base64 = await app.renderer.extract.base64({
        target: world,
        frame: new Rectangle(0, 0, CANVAS_W, CANVAS_H),
      })
      world.scale.set(prevScale)
      gizmo.visible = true

      const warp: { x: number; y: number }[] = []
      for (let i = 0; i < offsets.length / 2; i++) {
        warp.push({ x: offsets[i * 2], y: offsets[i * 2 + 1] })
      }

      await source.onSave({
        image_base64: base64.replace(/^data:image\/\w+;base64,/, ''),
        transform: {
          scale: garment.scale.x / (fitRef.current || 1),
          rotationDeg: (garment.rotation * 180) / Math.PI,
          tx: garment.x - homeRef.current.x,
          ty: garment.y - homeRef.current.y,
        },
        warp,
      })

      toast({ title: 'Placement saved' })
      setDirty(false)
      onSaved?.()
      onOpenChange(false)
    } catch (e) {
      if (gizmoRef.current) gizmoRef.current.visible = true
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [source, toast, onSaved, onOpenChange])

  useEffect(() => {
    if (!open || !garmentUrl || !host) return

    const mannequinUrl = mannequinAssetUrl(mannequin)
    let disposed = false
    historyRef.current = []
    setCanUndo(false)
    setLoading(true)
    setError(null)
    setDirty(false)

    const app = new Application()

    ;(async () => {
      try {
        await app.init({
          width: VIEW_W,
          height: VIEW_H,
          backgroundColor: 0xffffff,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        })
        if (disposed) { app.destroy(true); return }

        appRef.current = app
        host.appendChild(app.canvas)

        // Decode each image ONCE (in parallel), reused for both the Pixi texture and the pixel probe.
        // The mannequin (decode + bounds) is cached per gender across opens.
        const [man, garImg] = await Promise.all([
          loadMannequin(mannequinUrl),
          loadImage(garmentUrl),
        ])
        if (disposed) return
        const mannequinTex = Texture.from(man.img)
        const garmentTex = Texture.from(garImg)

        // Everything lives in world space (1800x3072); the world is scaled/panned so the mannequin
        // figure fills the view (see framing below). Save exports the world's own local frame, so
        // this display transform never affects the 1:1 composite.
        const world = new Container()
        app.stage.addChild(world)
        worldRef.current = world

        const base = new Sprite(mannequinTex)
        base.width = CANVAS_W
        base.height = CANVAS_H
        world.addChild(base)

        // Mannequin figure bounds (crop the blank margin so it fills the canvas) — cached per gender.
        const mb = man.bounds
        const displayScale = Math.min((VIEW_W - MARGIN * 2) / mb.w, (VIEW_H - MARGIN * 2) / mb.h)
        viewScaleRef.current = displayScale
        world.scale.set(displayScale)
        world.position.set(
          VIEW_W / 2 - (mb.x + mb.w / 2) * displayScale,
          VIEW_H / 2 - (mb.y + mb.h / 2) * displayScale,
        )

        // Replicate standardize_to_canvas: aspect-preserving fit, centred on the canvas. The fit
        // factor goes on the container, NOT on the mesh — the mesh stays at geometry scale so
        // vertex maths and pointer deltas share one coordinate space.
        const texW = garImg.width
        const texH = garImg.height
        const fit = Math.min(CANVAS_W / texW, CANVAS_H / texH)
        fitRef.current = fit

        // Learn where the cloth actually is inside its mostly-transparent frame (reuses the decode).
        const probe = await probeGarment(garImg, texW, texH)
        if (disposed) return
        const bounds = probe.bounds
        boundsRef.current = bounds

        const mesh = new MeshPlane({ texture: garmentTex, verticesX: MESH_X, verticesY: MESH_Y })
        mesh.position.set(-texW / 2, -texH / 2)
        mesh.eventMode = 'static'
        mesh.cursor = 'move'
        // Only the cloth itself starts a move drag — clicking the empty padding does nothing.
        mesh.hitArea = new Rectangle(bounds.x, bounds.y, bounds.w, bounds.h)
        meshRef.current = mesh

        const garment = new Container()
        garment.addChild(mesh)

        // Pivot on the centre of the cloth, not the centre of the padded frame, so scaling and
        // rotation happen about the garment itself instead of swinging it around in an arc.
        const pivotX = bounds.x + bounds.w / 2 - texW / 2
        const pivotY = bounds.y + bounds.h / 2 - texH / 2
        garment.pivot.set(pivotX, pivotY)

        // Compensate the pivot so the garment still starts exactly where the pipeline's
        // standardize_to_canvas would have placed it (whole frame centred on the canvas).
        const home = { x: CANVAS_W / 2 + pivotX * fit, y: CANVAS_H / 2 + pivotY * fit }
        homeRef.current = home

        garment.position.set(home.x, home.y)
        garment.scale.set(fit)
        world.addChild(garment)
        garmentRef.current = garment

        // Snapshot undeformed vertices; flag the ones on cloth; precompute pairwise drag weights.
        const buf = mesh.geometry.getBuffer('aPosition')
        const verts = buf.data as Float32Array
        baseVertsRef.current = new Float32Array(verts)
        vertOffsetsRef.current = new Float32Array(verts.length)

        const vCount = verts.length / 2
        const onCloth: boolean[] = new Array(vCount)
        for (let i = 0; i < vCount; i++) {
          onCloth[i] = probe.isOpaque(verts[i * 2], verts[i * 2 + 1])
        }
        onClothRef.current = onCloth

        // Distance measured in units of the cloth bounds so the falloff feels the same at any
        // texture padding. weightsRef[i * vCount + j]: dragging j pulls i by this fraction.
        const weights = new Float32Array(vCount * vCount)
        const uv = (i: number) => ({
          u: (verts[i * 2] - bounds.x) / (bounds.w || 1),
          v: (verts[i * 2 + 1] - bounds.y) / (bounds.h || 1),
        })
        for (let j = 0; j < vCount; j++) {
          const b = uv(j)
          for (let i = 0; i < vCount; i++) {
            const a = uv(i)
            const du = a.u - b.u
            const dv = a.v - b.v
            const w = Math.exp(-(du * du + dv * dv) / (2 * FALLOFF * FALLOFF))
            weights[i * vCount + j] = w < 0.01 ? 0 : w
          }
        }
        weightsRef.current = weights

        const gizmo = new Container()
        mesh.addChild(gizmo)
        gizmoRef.current = gizmo

        // Body drag → GRAB-ANYWHERE WARP (temp trial): press on the cloth where you want to reshape
        // (e.g. a sleeve cuff) and drag — the pull centers on the pressed point with soft falloff, so
        // you're not limited to the grid dots. Whole-garment MOVE lives on the top dot + arrow keys.
        mesh.on('pointerdown', (e) => {
          const base = baseVertsRef.current
          const offsets = vertOffsetsRef.current
          if (!base || !offsets) return
          const b = boundsRef.current
          const p = mesh.toLocal(e.global) // geometry space, same as the vertex-drag path
          const cu = (p.x - b.x) / (b.w || 1)
          const cv = (p.y - b.y) / (b.h || 1)
          const n = base.length / 2
          const weights = new Float32Array(n)
          for (let i = 0; i < n; i++) {
            const u = (base[i * 2] - b.x) / (b.w || 1)
            const v = (base[i * 2 + 1] - b.y) / (b.h || 1)
            const du = u - cu
            const dv = v - cv
            const w = Math.exp(-(du * du + dv * dv) / (2 * FALLOFF * FALLOFF))
            weights[i] = w < 0.01 ? 0 : w
          }
          pushHistory()
          dragRef.current = { kind: 'warpPoint', startPtr: p, weights, startOffsets: new Float32Array(offsets) }
        })

        app.stage.eventMode = 'static'
        app.stage.hitArea = app.screen

        // Top handle grab (rotation / Shift-move) — detected here rather than on the handle graphic,
        // which sits outside the mesh hit-area and is recreated every frame. Fires after the mesh's
        // own pointerdown for cloth clicks, but only acts when the pointer is on the handle region.
        app.stage.on('pointerdown', (e) => {
          const rh = rotHandleRef.current
          const g = garmentRef.current
          const m = meshRef.current
          if (!rh || !g || !m || dragRef.current) return
          const local = m.toLocal(e.global)
          if (Math.hypot(local.x - rh.x, local.y - rh.y) > rh.r) return
          pushHistory()
          const p = g.parent.toLocal(e.global)
          if (e.shiftKey) {
            dragRef.current = { kind: 'move', startPtr: p, startPos: { x: g.x, y: g.y } }
          } else {
            dragRef.current = {
              kind: 'rotate',
              startAngle: Math.atan2(p.y - g.y, p.x - g.x),
              startRotation: g.rotation,
            }
          }
        })

        app.stage.on('pointermove', (e) => {
          const drag = dragRef.current
          const g = garmentRef.current
          const m = meshRef.current
          if (!drag || !g || !m) return

          if (drag.kind === 'move') {
            const p = g.parent.toLocal(e.global)
            g.position.set(
              drag.startPos.x + (p.x - drag.startPtr.x),
              drag.startPos.y + (p.y - drag.startPtr.y),
            )
          } else if (drag.kind === 'scale') {
            const p = g.parent.toLocal(e.global)
            const d = Math.hypot(p.x - g.x, p.y - g.y)
            g.scale.set(Math.max(0.02, (d / drag.startDist) * drag.startScale))
          } else if (drag.kind === 'rotate') {
            const p = g.parent.toLocal(e.global)
            g.rotation = drag.startRotation + (Math.atan2(p.y - g.y, p.x - g.x) - drag.startAngle)
          } else if (drag.kind === 'vertex') {
            const p = m.toLocal(e.global)
            const dx = p.x - drag.startPtr.x
            const dy = p.y - drag.startPtr.y
            const offsets = vertOffsetsRef.current
            const weights = weightsRef.current
            if (!offsets || !weights) return
            const n = offsets.length / 2
            for (let i = 0; i < n; i++) {
              const w = weights[i * n + drag.index]
              if (w === 0) continue
              offsets[i * 2] = drag.startOffsets[i * 2] + dx * w
              offsets[i * 2 + 1] = drag.startOffsets[i * 2 + 1] + dy * w
            }
            applyWarp()
          } else if (drag.kind === 'warpPoint') {
            const p = m.toLocal(e.global)
            const dx = p.x - drag.startPtr.x
            const dy = p.y - drag.startPtr.y
            const offsets = vertOffsetsRef.current
            if (!offsets) return
            const n = offsets.length / 2
            for (let i = 0; i < n; i++) {
              const w = drag.weights[i]
              if (w === 0) continue
              offsets[i * 2] = drag.startOffsets[i * 2] + dx * w
              offsets[i * 2 + 1] = drag.startOffsets[i * 2 + 1] + dy * w
            }
            applyWarp()
          }
          setDirty(true)
          drawGizmo()
          syncXform()
        })

        const endDrag = () => { dragRef.current = null }
        app.stage.on('pointerup', endDrag)
        app.stage.on('pointerupoutside', endDrag)

        // Apply the stored placement transform, if one was persisted.
        const t = transform
        if (t) {
          garment.position.set(home.x + t.tx, home.y + t.ty)
          garment.scale.set(fit * t.scale)
          garment.rotation = (t.rotationDeg * Math.PI) / 180
        }

        // Restore the saved mesh warp so re-editing continues from the deformed shape.
        if (savedWarp && savedWarp.length && vertOffsetsRef.current) {
          const off = vertOffsetsRef.current
          const n = Math.min(savedWarp.length, off.length / 2)
          for (let i = 0; i < n; i++) {
            off[i * 2] = savedWarp[i].x
            off[i * 2 + 1] = savedWarp[i].y
          }
          applyWarp()
        }

        drawGizmo()
        // After the restore, not before — the rail must open showing the saved numbers.
        syncXform()
        setLoading(false)
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    })()

    return () => {
      disposed = true
      appRef.current = null
      worldRef.current = null
      meshRef.current = null
      garmentRef.current = null
      gizmoRef.current = null
      baseVertsRef.current = null
      vertOffsetsRef.current = null
      weightsRef.current = null
      onClothRef.current = []
      dragRef.current = null
      try { app.destroy(true, { children: true }) } catch { /* already torn down */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source?.key, host])

  // Arrow keys nudge the whole cloth up/down/left/right; Shift = larger step. (Canvas-px units.)
  useEffect(() => {
    if (!open) return
    const STEP = 12
    const BIG = 60
    const onKey = (e: KeyboardEvent) => {
      // The control rail's numeric fields are real inputs inside this dialog; without this guard an
      // arrow key inside one would move the caret AND nudge the garment.
      if (isEditableTarget(e.target)) return
      const g = garmentRef.current
      if (!g) return
      const step = e.shiftKey ? BIG : STEP
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      if (!e.repeat) pushHistory()
      g.position.set(g.x + dx, g.y + dy)
      setDirty(true)
      drawGizmo()
      syncXform()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pushHistory, drawGizmo, syncXform])

  if (!source) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] max-h-[92vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-sm">Placement mesh editor{source.label ? ` · ${source.label}` : ''}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
          {/* One aligned row: every column opens with the same ColumnLabel line and closes level
              with the previews (see the rail's `mt-auto`), so the rail, the canvas and the
              reference photo read as one band instead of three staggered blocks. The interaction
              hint lives under the row, full width — inside a 270px column it wrapped to three
              lines and pushed the dialog into a scroll. */}
          <div className="flex flex-wrap items-stretch justify-center gap-4">
            {/* Control rail — everything the canvas can do by hand, typeable to an exact value. */}
            <div className="flex w-[176px] shrink-0 flex-col gap-2.5">
              <ControlSection label="Position" first>
                <NumberStepper
                  label="X" value={xform.tx} unit="px" precision={0}
                  step={XFORM_STEPS.translate.step} bigStep={XFORM_STEPS.translate.big}
                  min={-CANVAS_W} max={CANVAS_W} disabled={!garmentUrl || loading}
                  onGestureStart={pushHistory}
                  onCommit={(tx) => applyXform({ tx }, { history: false })}
                />
                <NumberStepper
                  label="Y" value={xform.ty} unit="px" precision={0}
                  step={XFORM_STEPS.translate.step} bigStep={XFORM_STEPS.translate.big}
                  min={-CANVAS_H} max={CANVAS_H} disabled={!garmentUrl || loading}
                  onGestureStart={pushHistory}
                  onCommit={(ty) => applyXform({ ty }, { history: false })}
                />
              </ControlSection>

              <ControlSection label="Size">
                <NumberStepper
                  value={xform.scale} unit="×" precision={2}
                  step={XFORM_STEPS.scale.step} bigStep={XFORM_STEPS.scale.big}
                  min={SCALE_MIN} max={SCALE_MAX} disabled={!garmentUrl || loading}
                  onGestureStart={pushHistory}
                  onCommit={(scale) => applyXform({ scale }, { history: false })}
                />
                <p className="text-[9.5px] leading-tight text-muted-foreground">1.00 = pipeline default fit</p>
              </ControlSection>

              <ControlSection label="Rotation">
                <NumberStepper
                  value={xform.rotationDeg} unit="°" precision={1}
                  step={XFORM_STEPS.rotate.step} bigStep={XFORM_STEPS.rotate.big}
                  min={-180} max={180} disabled={!garmentUrl || loading}
                  onGestureStart={pushHistory}
                  onCommit={(rotationDeg) => applyXform({ rotationDeg }, { history: false })}
                />
              </ControlSection>

              {/* mt-auto: the row stretches this column to the previews' height, so pinning
                  History to the bottom lands it on their bottom edge. */}
              <ControlSection label="History" className="mt-auto">
                <Button size="sm" variant="outline" className="h-7 justify-start text-[11px]" onClick={undo} disabled={!canUndo}>
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Undo
                </Button>
                <Button size="sm" variant="outline" className="h-7 justify-start text-[11px]" onClick={resetAll} disabled={!garmentUrl || loading}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
                </Button>
              </ControlSection>
            </div>

            <div className="flex shrink-0 flex-col gap-1.5" style={{ width: VIEW_W }}>
              <ColumnLabel><span>Placement · {mannequin}</span></ColumnLabel>
              <div
                className="relative rounded-lg border border-border overflow-hidden bg-white"
                style={{ height: VIEW_H }}
                // Only reveal the mesh gizmo (dots / wireframe / handles) while the cursor is over the
                // canvas; hide it otherwise so the mannequin + placed cloth read cleanly.
                onMouseEnter={() => { if (gizmoRef.current) gizmoRef.current.visible = true }}
                onMouseLeave={() => { if (gizmoRef.current) gizmoRef.current.visible = false }}
              >
                <div ref={setHost} className="absolute inset-0" />
                {loading && garmentUrl && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {error && (
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <p className="text-[11px] text-destructive text-center">{error}</p>
                  </div>
                )}
                {!garmentUrl && (
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <p className="text-[11px] text-muted-foreground text-center">No garment image available.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Reference fit — the generated try-on, so placement aims at the real drape. Same box
                as the canvas, so the two mannequins are compared at one scale. */}
            <div className="flex shrink-0 flex-col gap-1.5" style={{ width: VIEW_W }}>
              <ColumnLabel>
                <span>Reference fit</span>
                {reference && (
                  // The provenance label doubles as the open-full-size link, keeping it out of a
                  // caption below the image — that caption is what broke the shared bottom edge.
                  <a
                    href={reference.url} target="_blank" rel="noreferrer"
                    title={`${reference.label} · open full size`}
                    className="flex min-w-0 items-center gap-1 hover:text-foreground"
                  >
                    <span className="truncate">{reference.label}</span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                )}
              </ColumnLabel>
              {reference ? (
                <a
                  href={reference.url} target="_blank" rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-border bg-white"
                  style={{ height: VIEW_H }}
                  title="Open full size"
                >
                  <img
                    src={reference.url}
                    alt={reference.label}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain"
                  />
                </a>
              ) : (
                <div
                  className="flex items-center justify-center rounded-lg border border-dashed border-border p-4"
                  style={{ height: VIEW_H }}
                >
                  <p className="text-center text-[11px] text-muted-foreground">No try-on reference for this item.</p>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-[10px] text-muted-foreground">
            Drag the cloth anywhere to reshape (warp) · arrow keys to move (Shift = bigger) · corners scale · top dot: drag rotates, Shift-drag moves
          </p>
        </div>

        <DialogFooter className="shrink-0">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button size="sm" disabled={!dirty || saving || !garmentUrl} onClick={handleSave}>
            {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Save placement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Wrapper 1: pipeline job (existing ingestion dashboard — unchanged API) ────────────────────

type JobProps = {
  job: PipelineJob | null
  placement: PlacementInfo | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function PlacementMeshEditor({ job, placement, open, onOpenChange, onSaved }: JobProps) {
  const source: PlacementEditorSource | null = job
    ? {
        key: `job:${job.job_id}:${job.segmented_image_url ?? ''}:${placement?.mannequin ?? ''}`,
        garmentUrl: job.segmented_image_url ?? null,
        mannequin: normalizeMannequin(placement?.mannequin, job.product_gender_type),
        transform: placement?.transform ?? null,
        warp: placement?.warp ?? null,
        // Same fallback the row tile uses (RowItem's `vton`). The two are labelled differently on
        // purpose: v_ton_preferred_image is the scraped photo that was fed INTO try-on generation,
        // not a render of this garment being worn, so it's a much weaker reference.
        reference: job.vton_image_url
          ? { url: job.vton_image_url, label: 'Generated try-on' }
          : job.v_ton_preferred_image
            ? { url: job.v_ton_preferred_image, label: 'Source photo · no try-on generated' }
            : null,
        onSave: (payload) => v2Api.savePlacement(job.job_id, payload).then(() => undefined),
      }
    : null
  return <PlacementMeshEditorCore source={source} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
}

// ─── Wrapper 2: legacy catalog product (/admin/placement — product-keyed save) ─────────────────

const DEFAULT_BODY_TYPE = 'bodytype1'

/** One entry inside a product's `placement` JSONB map (value of a "gender:body_type" key). */
export type PlacementMapEntry = {
  tx: number
  ty: number
  scale: number
  rotationDeg: number
  warp?: { x: number; y: number }[]
}

export type PlacementProduct = {
  id: string
  image_url: string | null
  gender: string | null
  product_name?: string | null
  /** The full placement map: { "gender:body_type": {tx,ty,scale,rotationDeg,warp} }. */
  placement?: Record<string, PlacementMapEntry> | null
  /**
   * Try-on shown read-only beside the canvas so the operator places against the real drape. Not a
   * products column — resolved from ingestion_pipeline_jobs (see useProductVton), so it's absent
   * for catalog items that predate the automated pipeline and for footwear, which has no VTON.
   */
  vton?: { url: string; label: string } | null
}

type ProductProps = {
  product: PlacementProduct | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function ProductPlacementEditor({ product, open, onOpenChange, onSaved }: ProductProps) {
  const source: PlacementEditorSource | null = product
    ? (() => {
        // Mannequin comes from the product's own gender (unisex → male default).
        const mannequin = normalizeMannequin(null, product.gender)
        const entry = product.placement?.[`${mannequin}:${DEFAULT_BODY_TYPE}`] ?? null
        return {
          key: `product:${product.id}:${product.image_url ?? ''}:${mannequin}`,
          garmentUrl: product.image_url ?? null,
          mannequin,
          transform: entry
            ? { scale: entry.scale, rotationDeg: entry.rotationDeg, tx: entry.tx, ty: entry.ty }
            : null,
          warp: entry?.warp ?? null,
          reference: product.vton ?? null,
          label: product.product_name ?? product.id.slice(0, 8),
          // Skip the composite upload: the studio renders from the transform map, not a preview image,
          // so a product save is just a fast JSONB merge (no multi-MB PNG round-trip).
          onSave: ({ transform, warp }) =>
            v2Api
              .savePlacementForProduct(product.id, { transform, warp, mannequin })
              .then(() => undefined),
        }
      })()
    : null
  return <PlacementMeshEditorCore source={source} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
}
