import { useEffect, useRef, useState, useCallback } from 'react'
import { Application, Assets, Container, Graphics, MeshPlane, Rectangle, Sprite, type Texture, type PointData } from 'pixi.js'
import { RotateCcw, Undo2, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { v2Api } from '@/utils/ingestionV2Api'
import type { PipelineJob } from '@/utils/ingestionV2Api'
import type { PlacementInfo } from './usePlacementImage'

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

type Drag =
  | { kind: 'move'; startPtr: PointData; startPos: PointData }
  | { kind: 'scale'; startDist: number; startScale: number }
  | { kind: 'rotate'; startAngle: number; startRotation: number }
  | { kind: 'vertex'; index: number; startPtr: PointData; startOffsets: Float32Array }
  | null

type Props = {
  job: PipelineJob | null
  placement: PlacementInfo | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

/**
 * A segmented garment PNG is mostly transparent padding. Probe its alpha once (downsampled) to
 * learn both the opaque bounding box and a point-in-cloth test, so the whole gizmo — grid,
 * vertex handles, hit area — can live on the cloth itself.
 */
async function probeGarment(url: string, texW: number, texH: number): Promise<GarmentProbe> {
  const fallback: GarmentProbe = {
    bounds: { x: 0, y: 0, w: texW, h: texH },
    isOpaque: () => true,
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('garment probe failed'))
      el.src = url
    })

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
async function probeMannequinBounds(url: string, texW: number, texH: number): Promise<Bounds> {
  const fallback: Bounds = { x: 0, y: 0, w: texW, h: texH }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('mannequin probe failed'))
      el.src = url
    })
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

function mannequinUrl(placement: PlacementInfo | undefined, job: PipelineJob | null): string {
  const picked = placement?.mannequin?.toLowerCase()
  if (picked === 'male' || picked === 'female') return `/mannequins/${picked}.png`
  return job?.product_gender_type === 'male' ? '/mannequins/male.png' : '/mannequins/female.png'
}

export function PlacementMeshEditor({ job, placement, open, onOpenChange, onSaved }: Props) {
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
  // Undo history — one snapshot per gesture (captured at pointerdown, before the change).
  const historyRef = useRef<Snapshot[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const { toast } = useToast()

  const segmentedUrl = job?.segmented_image_url ?? null

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

    const rot = new Graphics()
    rot.circle(midX, rotY, r).fill(0x2563eb).stroke({ width: lw, color: 0xffffff })
    rot.eventMode = 'static'
    rot.cursor = 'grab'
    rot.hitArea = { contains: (qx: number, qy: number) => Math.hypot(qx - midX, qy - rotY) < hit }
    rot.on('pointerdown', (e) => {
      e.stopPropagation()
      pushHistory()
      const p = garment.parent.toLocal(e.global)
      dragRef.current = {
        kind: 'rotate',
        startAngle: Math.atan2(p.y - garment.y, p.x - garment.x),
        startRotation: garment.rotation,
      }
    })
    gizmo.addChild(rot)
  }, [])

  const resetAll = useCallback(() => {
    const garment = garmentRef.current
    if (!garment) return
    const t = placement?.transform
    const home = homeRef.current
    garment.position.set(home.x + (t?.tx ?? 0), home.y + (t?.ty ?? 0))
    garment.scale.set(fitRef.current * (t?.scale ?? 1))
    garment.rotation = ((t?.rotationDeg ?? 0) * Math.PI) / 180
    vertOffsetsRef.current?.fill(0)
    historyRef.current = []
    setCanUndo(false)
    applyWarp()
    drawGizmo()
    setDirty(false)
  }, [placement, applyWarp, drawGizmo])

  const handleSave = useCallback(async () => {
    const app = appRef.current
    const world = worldRef.current
    const garment = garmentRef.current
    const gizmo = gizmoRef.current
    const offsets = vertOffsetsRef.current
    if (!app || !world || !garment || !gizmo || !offsets || !job) return

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

      await v2Api.savePlacement(job.job_id, {
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
  }, [job, toast, onSaved, onOpenChange])

  useEffect(() => {
    if (!open || !segmentedUrl || !host) return

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

        const [mannequinTex, garmentTex] = await Promise.all([
          Assets.load(mannequinUrl(placement, job)) as Promise<Texture>,
          Assets.load(segmentedUrl) as Promise<Texture>,
        ])
        if (disposed) return

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

        // Frame the mannequin figure (crop the blank margin around it) so it fills the canvas.
        const mb = await probeMannequinBounds(mannequinUrl(placement, job), CANVAS_W, CANVAS_H)
        if (disposed) return
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
        const texW = garmentTex.width
        const texH = garmentTex.height
        const fit = Math.min(CANVAS_W / texW, CANVAS_H / texH)
        fitRef.current = fit

        // Learn where the cloth actually is inside its mostly-transparent frame.
        const probe = await probeGarment(segmentedUrl, texW, texH)
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

        // Body drag → translate.
        mesh.on('pointerdown', (e) => {
          pushHistory()
          dragRef.current = {
            kind: 'move',
            startPtr: garment.parent.toLocal(e.global),
            startPos: { x: garment.x, y: garment.y },
          }
        })

        app.stage.eventMode = 'static'
        app.stage.hitArea = app.screen
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
          }
          setDirty(true)
          drawGizmo()
        })

        const endDrag = () => { dragRef.current = null }
        app.stage.on('pointerup', endDrag)
        app.stage.on('pointerupoutside', endDrag)

        // Apply the stored placement transform, if the pipeline persisted one.
        const t = placement?.transform
        if (t) {
          garment.position.set(home.x + t.tx, home.y + t.ty)
          garment.scale.set(fit * t.scale)
          garment.rotation = (t.rotationDeg * Math.PI) / 180
        }

        drawGizmo()
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
  }, [open, segmentedUrl, placement?.mannequin, host])

  if (!job) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] max-h-[92vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-sm">Placement mesh editor</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground min-w-0">
              Drag grid dots to warp the cloth · drag cloth to move · corners scale · top handle rotates
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={undo} disabled={!canUndo} className="flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground">
                <Undo2 className="h-3 w-3" /> Undo
              </button>
              <button onClick={resetAll} className="flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground">
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
          </div>

          <div className="relative self-center rounded-lg border border-border overflow-hidden bg-white" style={{ width: VIEW_W, height: VIEW_H }}>
            <div ref={setHost} className="absolute inset-0" />
            {loading && segmentedUrl && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <p className="text-[11px] text-destructive text-center">{error}</p>
              </div>
            )}
            {!segmentedUrl && (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <p className="text-[11px] text-muted-foreground text-center">No segmented garment on this job yet.</p>
              </div>
            )}
          </div>

        </div>

        <DialogFooter className="shrink-0">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button size="sm" disabled={!dirty || saving || !segmentedUrl} onClick={handleSave}>
            {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Save placement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
