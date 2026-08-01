import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Sparkles, Undo2, Redo2, Loader2, Pencil, X, ZoomIn, ZoomOut, RotateCcw, Brush, Eye } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { v2Api, type PipelineJob } from '@/utils/ingestionV2Api'
import { magicErase, warmUpEraser } from '@/utils/eraserApi'
import { useSegmentationSteps } from './useSegmentationSteps'

type Props = {
  job: PipelineJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful in-place save. */
  onSaved: () => void
}

type Mode = 'view' | 'edit'
type Tool = 'hard' | 'magic' | 'restore'

const MAX_HISTORY = 25
const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

// White = erase. Pink overlay only for on-screen feedback in magic mode.
const MASK_COLOR = 'rgba(236, 72, 153, 0.55)'

// Backdrop-colour tolerance, mirroring _strip_border_bg_from_mask (core_segmentation.py:447).
const BG_TOL = 30
// The FASHN mask is a SegFormer argmax upsampled to full res, so its boundary is a visible
// staircase. Blur, then threshold ABOVE 50%, which both antialiases the edge and pulls it ~1px
// INWARD. Never outward: a dilation is precisely "let the backdrop back in".
const GATE_BLUR_PX = 2
const GATE_LO = 140
const GATE_HI = 200
// A stroke whose most-open pixel is under this deposited nothing worth keeping.
const GATE_DEAD = 25

// crossOrigin is required or getImageData/toDataURL taint and both history and Save break.
const loadImage = (raw: string, param: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('image load failed'))
    img.src = raw.includes('?') ? `${raw}&${param}` : `${raw}?${param}`
  })

// Tints the BLOCKED region, not the open one — the operator needs to read the cloth clearly while
// painting, and red-on-forbidden is the conventional direction.
const buildGatePreview = (gate: Uint8Array, w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  const d = ctx.createImageData(w, h)
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    d.data[i] = 244; d.data[i + 1] = 63; d.data[i + 2] = 94
    d.data[i + 3] = gate[p] < 55 ? 90 : 0
  }
  ctx.putImageData(d, 0, 0)
  return c
}

export function SegmentEraserDialog({ job, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast()
  const imageCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)

  const [mode, setMode] = useState<Mode>('view')
  const [tool, setTool] = useState<Tool>('hard')
  const [brush, setBrush] = useState(36)      // on-screen diameter in px
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState<null | 'magic' | 'save'>(null)
  const [ready, setReady] = useState(false)
  const [hasMask, setHasMask] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [disp, setDisp] = useState<{ w: number; h: number }>({ w: 320, h: 400 })
  const [restoreReady, setRestoreReady] = useState(false)
  const [restoreErr, setRestoreErr] = useState<string | null>(null)
  const [clothOnly, setClothOnly] = useState(true)
  const [gateSource, setGateSource] = useState<'fashn' | 'color'>('color')
  const [preview, setPreview] = useState(false)
  const [blockedHint, setBlockedHint] = useState(false)
  // Bumped when a gate build completes, so the source pointer and the preview re-aim.
  const [gateVer, setGateVer] = useState(0)
  // Bumped whenever history changes so undo/redo button disabled-states re-render.
  const [, setHistVer] = useState(0)

  const history = useRef<ImageData[]>([])
  const histIdx = useRef(-1)
  const drawing = useRef(false)
  const lastPt = useRef<{ x: number; y: number } | null>(null)
  const naturalRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const rectRef = useRef<DOMRect | null>(null)          // cached stage rect for the active stroke
  const cursorRef = useRef<HTMLDivElement>(null)         // brush cursor moved imperatively (no re-render)
  const hoverRectRef = useRef<DOMRect | null>(null)      // stage rect while merely hovering
  // What strokeTo actually reads. Re-aimed by the Cloth-only toggle at one of the two below —
  // a pointer swap is atomic, where an async rebuild could be caught mid-write by a pointerdown.
  const restoreSrcRef = useRef<HTMLCanvasElement | null>(null)
  // The ORIGINAL vton frame the pipeline segmented, pixel-aligned 1:1 with the cutout (segmentation
  // neither crops nor resizes — green_screen_pipeline.py:396). Restore copies out of this.
  const rawSrcRef = useRef<HTMLCanvasElement | null>(null)
  // Same pixels, alpha replaced by the cloth gate. strokeTo's 'source-in' composite already
  // respects source alpha, so gating needs no change at all to the hot path.
  const gatedSrcRef = useRef<HTMLCanvasElement | null>(null)
  const gateRef = useRef<Uint8Array | null>(null)        // 1 byte/px, powers cursor + preview + hint
  const gatePreviewRef = useRef<HTMLCanvasElement | null>(null)
  const previewDrawn = useRef(false)                     // does the preview currently own maskCanvas?
  const pendingGate = useRef<HTMLImageElement | null>(null)   // mask that landed mid-stroke
  const strokeMaxGate = useRef(0)
  const origDataRef = useRef<ImageData | null>(null)
  const cutImgRef = useRef<HTMLImageElement | null>(null)
  // Canvas2D has no "clip to a stroke", so each restore segment is shaped here via 'source-in'.
  const scratchRef = useRef<HTMLCanvasElement | null>(null)

  // Fit the image into the space left after the title + controls so the whole dialog
  // shows at once — no scrolling to reach the tools. Edit mode reserves more for its rows.
  const computeDisp = useCallback((editMode: boolean) => {
    const n = naturalRef.current
    if (!n.w || !n.h) return
    // Reserved unconditionally in edit mode (not only for Restore) so switching tools doesn't
    // resize the stage under the cursor mid-edit.
    const reserve = editMode ? 248 : 120
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const maxH = Math.max(200, vh * 0.92 - reserve)
    const maxW = 512
    const ar = n.w / n.h
    let w = maxW, h = maxW / ar
    if (h > maxH) { h = maxH; w = maxH * ar }
    setDisp({ w: Math.round(w), h: Math.round(h) })
  }, [])

  const url = job?.segmented_image_url ?? null
  const vtonUrl = job?.vton_image_url ?? null
  // The pipeline's own coarse garment mask — the semantic half of the cloth gate. Its failure to
  // load is never fatal: the colour-only gate stands and the UI badges it.
  const { fashnGarmentUrl } = useSegmentationSteps(open ? job?.job_id ?? null : null)

  const bumpHist = () => setHistVer(v => v + 1)

  const pushHistory = useCallback(() => {
    const c = imageCanvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    try {
      const snap = ctx.getImageData(0, 0, c.width, c.height)
      history.current = history.current.slice(0, histIdx.current + 1)
      history.current.push(snap)
      if (history.current.length > MAX_HISTORY) history.current.shift()
      histIdx.current = history.current.length - 1
      bumpHist()
    } catch {
      toast({
        title: 'Cannot edit this image',
        description: 'The segmented image blocked canvas access (CORS). Re-run segmentation or check storage CORS.',
        variant: 'destructive',
      })
    }
  }, [toast])

  const clearMask = useCallback(() => {
    const m = maskCanvasRef.current
    if (!m) return
    m.getContext('2d')!.clearRect(0, 0, m.width, m.height)
    setHasMask(false)
  }, [])

  // Bake the original into an offscreen layer ONCE per open, so a pointermove only ever does a
  // drawImage. Also the taint probe: the getImageData below throws before any tainted pixel can
  // reach imageCanvas, which would permanently break pushHistory and Save.
  const buildRestoreSource = useCallback((orig: HTMLImageElement, cut: HTMLImageElement) => {
    const w = cut.naturalWidth, h = cut.naturalHeight
    const ow = orig.naturalWidth, oh = orig.naturalHeight
    if (Math.abs(ow / oh - w / h) / (w / h) > 0.01) {
      setRestoreErr(`Original is ${ow}×${oh} but the cutout is ${w}×${h} — they would not line up.`)
      return
    }
    const raw = document.createElement('canvas')
    raw.width = w; raw.height = h
    const rctx = raw.getContext('2d', { willReadFrequently: true })!
    // Same dims in practice; the scale is pure defence against a re-encoded vton frame.
    rctx.drawImage(orig, 0, 0, ow, oh, 0, 0, w, h)
    let od: ImageData
    try {
      od = rctx.getImageData(0, 0, w, h)
    } catch {
      setRestoreErr('The original image blocked canvas access (CORS).')
      return
    }
    const scratch = document.createElement('canvas')
    scratch.width = w; scratch.height = h
    rawSrcRef.current = raw
    restoreSrcRef.current = raw   // usable immediately; the gate effect re-aims once it exists
    scratchRef.current = scratch
    // The gate characterises the garment from the UNEDITED cutout, so hold the element rather than
    // reading imageCanvas later — by then the operator may have erased half of it.
    cutImgRef.current = cut
    origDataRef.current = od
    setRestoreErr(null)
    setRestoreReady(true)
  }, [])

  // Fills the restore source's ALPHA with a "is this cloth?" gate. strokeTo's existing 'source-in'
  // composite already respects that alpha, so the hot path needs zero changes.
  // fashn=null → the colour rules alone (degraded; surfaced in the UI as an amber badge).
  const buildGate = useCallback((fashn: HTMLImageElement | null) => {
    const raw = rawSrcRef.current, cut = cutImgRef.current, od = origDataRef.current
    if (!raw || !cut || !od) return
    const w = raw.width, h = raw.height, n = w * h
    const src = od.data
    const t0 = performance.now()

    const tmp = document.createElement('canvas')
    tmp.width = w; tmp.height = h
    const tctx = tmp.getContext('2d', { willReadFrequently: true })!

    // 1. Garment colour signature, from pixels the pipeline ALREADY accepted as cloth. Used only to
    //    disarm the colour rules below, never as a spatial constraint — the whole point of Restore
    //    is to paint OUTSIDE the surviving alpha.
    tctx.drawImage(cut, 0, 0, w, h)
    const cutA = tctx.getImageData(0, 0, w, h).data
    let mr = 0, mg = 0, mb = 0, mn = 0
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (cutA[i + 3] > 200) { mr += src[i]; mg += src[i + 1]; mb += src[i + 2]; mn++ }
    }
    if (mn) { mr /= mn; mg /= mn; mb /= mn }

    // green_screen_pipeline.py:229 verbatim. A tan/beige garment trips the skin rule, so the
    // pipeline disables colour-skin subtraction for it — do the same, or Restore silently refuses
    // to paint a nude-coloured top back in.
    const garmentIsSkin = mn > 0 && mr > 95 && mg > 40 && mb > 20 &&
      mr > mg && mr > mb && mr - mg > 10 && mr - mb > 10

    // 2. Backdrop colour: mode of the ORIGINAL's outer ring in 32-level bins, so sensor noise and a
    //    soft vignette still land in one bucket.
    const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02))
    const bins = new Int32Array(32768)
    let bestN = -1, bestBin = 0
    const tally = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4
          const b = ((src[i] >> 3) << 10) | ((src[i + 1] >> 3) << 5) | (src[i + 2] >> 3)
          const c = ++bins[b]
          if (c > bestN) { bestN = c; bestBin = b }
        }
      }
    }
    tally(0, 0, w, ring); tally(0, h - ring, w, h)
    tally(0, ring, ring, h - ring); tally(w - ring, ring, w, h - ring)
    const bgR = ((bestBin >> 10) & 31) * 8 + 4
    const bgG = ((bestBin >> 5) & 31) * 8 + 4
    const bgB = (bestBin & 31) * 8 + 4

    // White top on a white backdrop: the bg rule would eat the garment. Disarm it and lean on
    // FASHN. With no FASHN either the gate is skin-only, which the badge + hint text admit.
    const garmentIsBg = mn > 0 &&
      Math.max(Math.abs(mr - bgR), Math.abs(mg - bgG), Math.abs(mb - bgB)) < BG_TOL * 1.5

    // 3. FASHN garment mask. cv2.imwrite of a 2-D array ⇒ GRAYSCALE png with alpha 255 everywhere,
    //    so read the RED channel — gating on alpha would silently leave the gate wide open.
    let fa: Uint8ClampedArray | null = null
    if (fashn) {
      tctx.clearRect(0, 0, w, h)
      tctx.filter = `blur(${GATE_BLUR_PX}px)`
      tctx.drawImage(fashn, 0, 0, fashn.naturalWidth, fashn.naturalHeight, 0, 0, w, h)
      tctx.filter = 'none'
      fa = tctx.getImageData(0, 0, w, h).data
    }

    // 4. Single pass. gate[] is kept because it powers the cursor tint, the preview and the
    //    "nothing was restored" hint as O(1) lookups.
    const gate = new Uint8Array(n)
    const out = new ImageData(new Uint8ClampedArray(src), w, h)
    let open = 0
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      let g = 255
      if (fa) {
        const v = fa[i]
        g = v <= GATE_LO ? 0 : v >= GATE_HI ? 255 : (((v - GATE_LO) * 255) / (GATE_HI - GATE_LO)) | 0
      }
      if (g) {
        const r = src[i], gr = src[i + 1], bl = src[i + 2]
        // green_screen_pipeline.py:238 verbatim.
        if (!garmentIsSkin && r > 95 && gr > 40 && bl > 20 && r - gr > 15 && r - bl > 15 && r > gr && r > bl) g = 0
        // _strip_border_bg_from_mask's colour test, minus its connected-component walk — too slow
        // in JS, and FASHN already bounds the region.
        else if (!garmentIsBg && Math.abs(r - bgR) < BG_TOL && Math.abs(gr - bgG) < BG_TOL && Math.abs(bl - bgB) < BG_TOL) g = 0
      }
      gate[p] = g
      out.data[i + 3] = g
      if (g > 127) open++
    }

    // FASHN produced (almost) nothing — an empty parse or the wrong category. Gating on it would
    // make Restore look broken, and a dead brush is worse than a leaky one.
    if (fa && open < n * 0.01) { buildGate(null); return }

    const gated = gatedSrcRef.current ?? document.createElement('canvas')
    gated.width = w; gated.height = h
    gated.getContext('2d')!.putImageData(out, 0, 0)
    gatedSrcRef.current = gated
    gateRef.current = gate
    gatePreviewRef.current = buildGatePreview(gate, w, h)
    setGateSource(fa ? 'fashn' : 'color')
    setGateVer(v => v + 1)
    if (import.meta.env.DEV) console.debug(`[restore] gate ${Math.round(performance.now() - t0)}ms`, { source: fa ? 'fashn' : 'color', garmentIsSkin, garmentIsBg })
  }, [])

  // (Re)load the source image into the canvas whenever the dialog opens.
  useEffect(() => {
    if (!open || !url) return
    let cancelled = false
    setReady(false)
    setRestoreReady(false)
    setRestoreErr(null)
    setPreview(false)
    setBlockedHint(false)
    setGateSource('color')
    restoreSrcRef.current = null
    rawSrcRef.current = null
    gatedSrcRef.current = null
    gateRef.current = null
    gatePreviewRef.current = null
    previewDrawn.current = false
    pendingGate.current = null
    origDataRef.current = null
    cutImgRef.current = null
    scratchRef.current = null
    setMode('view')
    setTool('hard')
    setZoom(1)
    warmUpEraser()   // start the Modal container so the first magic Erase isn't a cold start

    const cutoutP = loadImage(url, `cb=${Date.now()}`)

    cutoutP.then(img => {
      if (cancelled) return
      const ic = imageCanvasRef.current
      const mc = maskCanvasRef.current
      if (!ic || !mc) return
      ic.width = mc.width = img.naturalWidth
      ic.height = mc.height = img.naturalHeight
      const ictx = ic.getContext('2d')!
      ictx.clearRect(0, 0, ic.width, ic.height)
      ictx.drawImage(img, 0, 0)
      mc.getContext('2d')!.clearRect(0, 0, mc.width, mc.height)
      history.current = []
      histIdx.current = -1
      setHasMask(false)
      naturalRef.current = { w: img.naturalWidth, h: img.naturalHeight }
      computeDisp(false)
      setReady(true)
      pushHistory()
    }).catch(() => {
      if (!cancelled) toast({ title: 'Failed to load segmented image', variant: 'destructive' })
    })

    if (!vtonUrl) {
      setRestoreErr('This job has no original try-on image, so there is nothing to restore from.')
    } else {
      // Sequenced after the cutout only because the source is built at the CUTOUT's dims. A failure
      // here disables Restore and nothing else — hard and magic erase stay usable.
      // The stable ?cors=1 (not a timestamp — the original never changes in place) keeps this in a
      // separate cache entry from the plain <img> loads of the same URL in RowItem/ItemDetailPage,
      // whose cached no-CORS response would come back tainted.
      Promise.all([cutoutP, loadImage(vtonUrl, 'cors=1')])
        .then(([cut, orig]) => {
          if (cancelled) return
          buildRestoreSource(orig, cut)
        })
        .catch(() => {
          if (!cancelled) setRestoreErr('The original try-on image could not be loaded (CORS or missing).')
        })
    }

    return () => { cancelled = true }
  }, [open, url, vtonUrl, pushHistory, toast, computeDisp, buildRestoreSource])

  // Phase 1: the colour-only gate, the instant the bake lands. No network, so Restore is gated from
  // the first stroke rather than being ungated until a fetch resolves.
  useEffect(() => { if (restoreReady) buildGate(null) }, [restoreReady, buildGate])

  // Phase 2: silently upgrade to FASHN ∧ colour when the mask arrives. Deferred while a stroke is
  // in flight so one stroke never straddles two gates — onPointerUp drains it.
  useEffect(() => {
    if (!restoreReady || !fashnGarmentUrl) return
    let cancelled = false
    loadImage(fashnGarmentUrl, 'cors=1')
      .then(img => {
        if (cancelled) return
        if (drawing.current) pendingGate.current = img
        else buildGate(img)
      })
      .catch(() => { /* 404 / CORS / moved bucket — the colour gate stands, the badge already says so */ })
    return () => { cancelled = true }
  }, [restoreReady, fashnGarmentUrl, buildGate])

  // Re-aim the pointer strokeTo reads. Swapping a reference is atomic; rebuilding a single source
  // on every toggle would stall the one interaction that has to feel free (see the blocked hint).
  useEffect(() => {
    restoreSrcRef.current = clothOnly ? (gatedSrcRef.current ?? rawSrcRef.current) : rawSrcRef.current
  }, [clothOnly, gateVer, restoreReady])

  // maskCanvas is idle in restore mode (it's the magic-highlight layer, and entering restore clears
  // it), so the gate preview borrows it — one drawImage, no new DOM. Must NOT touch hasMask: that
  // flag drives Undo's "clear highlight" branch and buildBinaryMask, neither of which should ever
  // see the preview.
  useEffect(() => {
    const m = maskCanvasRef.current
    if (!m) return
    const show = preview && clothOnly && tool === 'restore' && !!gatePreviewRef.current
    // Only ever clear a canvas the preview itself drew on — otherwise a gate upgrade landing while
    // the operator has a magic highlight pending would silently wipe it.
    if (!show && !previewDrawn.current) return
    const ctx = m.getContext('2d')!
    ctx.clearRect(0, 0, m.width, m.height)
    if (show) ctx.drawImage(gatePreviewRef.current!, 0, 0)
    previewDrawn.current = show
  }, [preview, clothOnly, tool, gateVer])

  // Refit when switching view↔edit (controls change height) or when the window resizes.
  useEffect(() => {
    computeDisp(mode === 'edit')
    const onResize = () => computeDisp(mode === 'edit')
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mode, computeDisp])

  // Tick an elapsed-seconds counter while a magic erase is in flight (cold start can be ~30s).
  useEffect(() => {
    if (busy !== 'magic') { setElapsed(0); return }
    const started = performance.now()
    const id = setInterval(() => setElapsed(Math.round((performance.now() - started) / 1000)), 500)
    return () => clearInterval(id)
  }, [busy])

  const restore = (idx: number) => {
    const c = imageCanvasRef.current
    const snap = history.current[idx]
    if (!c || !snap) return
    c.getContext('2d')!.putImageData(snap, 0, 0)
    clearMask()
  }
  const undo = () => {
    // A pending magic highlight isn't in image history — first Undo clears it (reverts the highlight).
    if (hasMask) { clearMask(); return }
    if (histIdx.current > 0) { histIdx.current--; restore(histIdx.current); bumpHist() }
  }
  const redo = () => { if (histIdx.current < history.current.length - 1) { histIdx.current++; restore(histIdx.current); bumpHist() } }
  const resetOriginal = () => {
    if (history.current.length === 0) return
    histIdx.current = 0
    restore(0)
    bumpHist()
  }
  const canUndo = histIdx.current > 0
  const canRedo = histIdx.current < history.current.length - 1

  // Map a pointer event to internal canvas coords using a cached rect (rect reflects CSS
  // scale + zoom). Caching per-stroke avoids getBoundingClientRect reflow on every move.
  const coordsFrom = (e: React.PointerEvent, rect: DOMRect) => {
    const c = maskCanvasRef.current!
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    }
  }

  const strokeTo = (p: { x: number; y: number }, scale: number) => {
    const prev = lastPt.current ?? p
    const lineWidth = brush * scale   // brush is on-screen px → convert to internal
    if (tool === 'hard') {
      const ctx = imageCanvasRef.current!.getContext('2d')!
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineCap = ctx.lineJoin = 'round'
      ctx.lineWidth = lineWidth
      ctx.strokeStyle = 'rgba(0,0,0,1)'
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
    } else if (tool === 'restore') {
      const src = restoreSrcRef.current
      const sc = scratchRef.current
      if (!src || !sc) return
      // Only this segment's footprint is touched — full-canvas ops per pointermove would move
      // ~12MB at 1500×2000 and drop frames. Round cap ⇒ half the line width plus AA slack bounds it.
      const pad = lineWidth / 2 + 2
      const x0 = Math.max(0, Math.floor(Math.min(prev.x, p.x) - pad))
      const y0 = Math.max(0, Math.floor(Math.min(prev.y, p.y) - pad))
      const x1 = Math.min(sc.width, Math.ceil(Math.max(prev.x, p.x) + pad))
      const y1 = Math.min(sc.height, Math.ceil(Math.max(prev.y, p.y) + pad))
      const bw = x1 - x0, bh = y1 - y0
      // Record whether this segment reached anything restorable, read by onPointerUp to explain a
      // stroke that deposited nothing. It has to sample the whole brush footprint, not just the
      // pointer: painting along the edge of a blocked region deposits real pixels while the centre
      // sits on a blocked one, and treating that as a no-op would skip pushHistory and leave those
      // pixels out of the undo stack. Grid over the segment's bbox, rejecting samples outside the
      // round-capped line so the test matches what actually gets drawn.
      const gate = gateRef.current
      if (gate) {
        const r = lineWidth / 2
        const step = Math.max(1, Math.floor(r / 2))
        const dx = p.x - prev.x, dy = p.y - prev.y
        const len2 = dx * dx + dy * dy
        for (let sy = y0; sy < y1 && strokeMaxGate.current < 255; sy += step) {
          for (let sx = x0; sx < x1; sx += step) {
            // Distance from the sample to the segment, via the closest point on it.
            const t = len2 ? Math.max(0, Math.min(1, ((sx - prev.x) * dx + (sy - prev.y) * dy) / len2)) : 0
            const cx = prev.x + t * dx - sx, cy = prev.y + t * dy - sy
            if (cx * cx + cy * cy > r * r) continue
            const g = gate[sy * sc.width + sx]
            if (g > strokeMaxGate.current) strokeMaxGate.current = g
          }
        }
      } else {
        strokeMaxGate.current = 255
      }
      if (bw > 0 && bh > 0) {
        const sctx = sc.getContext('2d')!
        // The clip is load-bearing: unclipped, 'source-in' composites against destination alpha
        // across the WHOLE scratch layer, not just the rect we drew into.
        sctx.save()
        sctx.beginPath(); sctx.rect(x0, y0, bw, bh); sctx.clip()
        sctx.clearRect(x0, y0, bw, bh)   // must precede the op switch — clearRect ignores it
        sctx.globalCompositeOperation = 'source-over'
        sctx.lineCap = sctx.lineJoin = 'round'
        sctx.lineWidth = lineWidth
        sctx.strokeStyle = '#000'        // colour is irrelevant, only the stroke's ALPHA is used
        sctx.beginPath(); sctx.moveTo(prev.x, prev.y); sctx.lineTo(p.x, p.y); sctx.stroke()
        // No "clip to a stroke" in Canvas2D, so shape the original through the stroke instead.
        sctx.globalCompositeOperation = 'source-in'
        sctx.drawImage(src, x0, y0, bw, bh, x0, y0, bw, bh)
        sctx.restore()
        sctx.globalCompositeOperation = 'source-over'

        const ictx = imageCanvasRef.current!.getContext('2d')!
        ictx.globalCompositeOperation = 'source-over'
        ictx.drawImage(sc, x0, y0, bw, bh, x0, y0, bw, bh)
      }
    } else {
      const ctx = maskCanvasRef.current!.getContext('2d')!
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineCap = ctx.lineJoin = 'round'
      ctx.lineWidth = lineWidth
      ctx.strokeStyle = MASK_COLOR
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke()
      if (!hasMask) setHasMask(true)
    }
    lastPt.current = p
  }

  // Position the brush cursor by mutating the DOM node directly — no state, no re-render.
  const moveCursor = (e: React.PointerEvent) => {
    const el = cursorRef.current
    if (!el) return
    el.style.left = `${e.clientX}px`
    el.style.top = `${e.clientY}px`
    el.style.display = 'block'
    if (tool !== 'restore') return
    const gate = gateRef.current
    const rect = rectRef.current ?? hoverRectRef.current
    if (!rect || !gate || !clothOnly) return
    const c = maskCanvasRef.current!
    const x = (((e.clientX - rect.left) / rect.width) * c.width) | 0
    const y = (((e.clientY - rect.top) / rect.height) * c.height) | 0
    const blocked = x < 0 || y < 0 || x >= c.width || y >= c.height || gate[y * c.width + x] < 55
    // Green ring = the stroke will deposit here, grey dashed = the gate is blocking. Reading it off
    // the cursor is what stops a blocked stroke being mistaken for a broken tool.
    el.style.borderColor = blocked ? 'rgba(255,255,255,0.35)' : '#34d399'
    el.style.borderStyle = blocked ? 'dashed' : 'solid'
  }
  const hideCursor = () => { if (cursorRef.current) cursorRef.current.style.display = 'none' }
  // The gate lookup in moveCursor needs a rect, but getBoundingClientRect per move is a reflow —
  // cache it on enter. Zoom/resize change it, so key the handler on both.
  const onPointerEnter = () => { hoverRectRef.current = maskCanvasRef.current?.getBoundingClientRect() ?? null }

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== 'edit' || busy) return
    const mc = maskCanvasRef.current!
    drawing.current = true
    mc.setPointerCapture(e.pointerId)
    const rect = mc.getBoundingClientRect()
    rectRef.current = rect
    lastPt.current = null
    strokeMaxGate.current = 0
    setBlockedHint(false)
    strokeTo(coordsFrom(e, rect), mc.width / rect.width)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    moveCursor(e)
    if (!drawing.current) return
    const rect = rectRef.current
    if (!rect) return
    strokeTo(coordsFrom(e, rect), maskCanvasRef.current!.width / rect.width)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drawing.current) return
    drawing.current = false
    try { maskCanvasRef.current!.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    lastPt.current = null
    rectRef.current = null
    // A mask that landed mid-stroke was held back so the stroke couldn't straddle two gates.
    if (pendingGate.current) { const g = pendingGate.current; pendingGate.current = null; buildGate(g) }
    if (tool === 'restore' && clothOnly && strokeMaxGate.current < GATE_DEAD) {
      // Nothing was deposited, so the canvas is unchanged — pushing an identical multi-MB snapshot
      // would burn a history slot and make the next Undo appear to do nothing.
      setBlockedHint(true)
      return
    }
    if (tool !== 'magic') pushHistory()   // one history entry per completed erase / restore stroke
  }

  const canvasToBlob = (c: HTMLCanvasElement): Promise<Blob> =>
    new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))

  // Black/white binary mask (white = painted = erase) from the pink overlay.
  const buildBinaryMask = async (): Promise<Blob> => {
    const m = maskCanvasRef.current!
    const src = m.getContext('2d')!.getImageData(0, 0, m.width, m.height)
    const out = document.createElement('canvas')
    out.width = m.width; out.height = m.height
    const octx = out.getContext('2d')!
    const bin = octx.createImageData(m.width, m.height)
    for (let i = 0; i < src.data.length; i += 4) {
      const v = src.data[i + 3] > 10 ? 255 : 0
      bin.data[i] = bin.data[i + 1] = bin.data[i + 2] = v
      bin.data[i + 3] = 255
    }
    octx.putImageData(bin, 0, 0)
    return canvasToBlob(out)
  }

  const runErase = async () => {
    if (!hasMask || busy) return
    const ic = imageCanvasRef.current!
    const mc = maskCanvasRef.current!
    const ictx = ic.getContext('2d')!
    const w = ic.width, h = ic.height
    setBusy('magic')
    try {
      // Snapshot the current image + mask before the round-trip.
      const orig = ictx.getImageData(0, 0, w, h)
      const maskData = mc.getContext('2d')!.getImageData(0, 0, w, h)

      // The segmented image is transparent outside the garment, and LaMa (on Modal) flattens
      // transparent → BLACK before inpainting — so edge fills come back black. Flatten the
      // image over the garment's MEAN colour first, so the model blends with fabric, not black.
      let r = 0, g = 0, b = 0, n = 0
      for (let i = 0; i < orig.data.length; i += 4) {
        if (orig.data[i + 3] > 128) { r += orig.data[i]; g += orig.data[i + 1]; b += orig.data[i + 2]; n++ }
      }
      const fill = n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : 'rgb(255,255,255)'
      const flat = document.createElement('canvas')
      flat.width = w; flat.height = h
      const fctx = flat.getContext('2d')!
      fctx.fillStyle = fill
      fctx.fillRect(0, 0, w, h)
      fctx.drawImage(ic, 0, 0)

      const [image, mask] = await Promise.all([canvasToBlob(flat), buildBinaryMask()])
      const result = await magicErase(image, mask)
      const bmp = await createImageBitmap(result)

      const tmp = document.createElement('canvas')
      tmp.width = w; tmp.height = h
      const tctx = tmp.getContext('2d')!
      tctx.drawImage(bmp, 0, 0, w, h)
      const lama = tctx.getImageData(0, 0, w, h)

      const outData = ictx.createImageData(w, h)
      for (let i = 0; i < outData.data.length; i += 4) {
        if (maskData.data[i + 3] > 10) {
          // Erased region → model fill, but KEEP the original alpha so transparent areas stay
          // transparent (forcing them opaque is what produced the solid black patches).
          outData.data[i] = lama.data[i]
          outData.data[i + 1] = lama.data[i + 1]
          outData.data[i + 2] = lama.data[i + 2]
          outData.data[i + 3] = orig.data[i + 3]
        } else {
          outData.data[i] = orig.data[i]
          outData.data[i + 1] = orig.data[i + 1]
          outData.data[i + 2] = orig.data[i + 2]
          outData.data[i + 3] = orig.data[i + 3]
        }
      }
      ictx.putImageData(outData, 0, 0)
      clearMask()
      pushHistory()
      toast({ title: 'Erase applied' })
    } catch (e) {
      toast({ title: 'Erase failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!url || busy) return
    if (!window.confirm('This overwrites the current segmented image in place and cannot be undone after saving. Continue?')) return
    setBusy('save')
    try {
      // Send the edited PNG to the backend, which overwrites the object via the service-role
      // key (the browser anon key is blocked by storage RLS).
      const dataUrl = imageCanvasRef.current!.toDataURL('image/png')
      await v2Api.saveSegmentedImage(job!.job_id, dataUrl)
      toast({ title: 'Segmented image updated' })

      // Placement derives its origin from the cutout's alpha bounding box
      // (placement_pipeline.py:87-91), so editing the mask leaves an already-placed job offset by
      // about half the change. The LoFTR registration is computed from the vton image and is
      // unaffected — it just has to run again. 'placement' is the last STEP_ORDER entry, so the
      // restart keeps the segmentation data and the ingested_product link (restart.ts:84,89).
      if (job!.ingested_product_id && window.confirm('Placement was computed from the previous cutout and is now offset. Re-run placement?')) {
        try {
          await v2Api.restart(job!.job_id, 'placement')
          toast({ title: 'Placement re-queued' })
        } catch (e) {
          toast({
            title: 'Could not re-run placement',
            description: e instanceof Error ? e.message : 'Re-run it from the row actions once the job settles.',
            variant: 'destructive',
          })
        }
      }

      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  if (!job) return null

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="flex max-h-[94vh] max-w-[560px] flex-col overflow-hidden">
        <DialogTitle className="text-sm">
          {mode === 'view' ? 'Segmented output' : 'AI eraser'}
        </DialogTitle>

        {/* Brush cursor — portalled to <body> so the dialog's transform doesn't offset a fixed child,
            and moved imperatively (see moveCursor) so erasing doesn't re-render React each pixel. */}
        {mode === 'edit' && !busy && createPortal(
          <div
            ref={cursorRef}
            className="pointer-events-none fixed z-[9999] hidden rounded-full border"
            style={{
              width: brush,
              height: brush,
              transform: 'translate(-50%,-50%)',
              boxShadow: '0 0 0 1.5px rgba(0,0,0,0.55)',
              // Restore adds pixels rather than removing them — tint the ring so the operator can
              // see which way the brush cuts without looking down at the toolbar.
              borderColor: tool === 'restore' ? '#34d399' : '#fff',
            }}
          />,
          document.body,
        )}

        {/* Canvas stage — sized to fit the space left after the controls, so nothing scrolls.
            Only when zoomed >1 does the viewport bound + scroll to pan. Zoom scales the stage's
            actual width/height (not a CSS transform) so the scroll area grows in every direction,
            and m-auto centers it while staying scrollable to all edges (flex center clips the
            top/left of an overflowing child). */}
        <div className={cn('flex min-h-0 flex-1', zoom > 1 ? 'overflow-auto' : 'overflow-hidden')}>
          {!url ? (
            <div className="m-auto flex aspect-[4/5] w-[300px] items-center justify-center rounded-lg border border-border text-xs text-muted-foreground">No segmented image</div>
          ) : (
            <div
              className="relative m-auto shrink-0 rounded-lg border border-border bg-[repeating-conic-gradient(#e5e7eb_0_25%,#f3f4f6_0_50%)] bg-[length:16px_16px]"
              style={{ width: disp.w * zoom, height: disp.h * zoom }}
            >
              <canvas ref={imageCanvasRef} className="absolute inset-0 h-full w-full" />
              <canvas
                ref={maskCanvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerEnter={onPointerEnter}
                onPointerLeave={hideCursor}
                className={cn('absolute inset-0 h-full w-full', mode === 'edit' ? 'cursor-none' : 'pointer-events-none')}
              />
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {busy === 'magic' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-xs font-medium">Erasing… {elapsed}s</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        {mode === 'view' ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              <X className="mr-1 h-3.5 w-3.5" /> Close
            </Button>
            <Button size="sm" disabled={!ready} onClick={() => setMode('edit')}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Tool toggle */}
            <div className="flex gap-2">
              <Button size="sm" variant={tool === 'hard' ? 'default' : 'outline'} className="flex-1 px-2 text-[11px]" onClick={() => { setTool('hard'); clearMask() }} disabled={!!busy} title="Erase pixels to transparent">
                <Eraser className="mr-1 h-3.5 w-3.5" /> Erase
              </Button>
              <Button size="sm" variant={tool === 'magic' ? 'default' : 'outline'} className="flex-1 px-2 text-[11px]" onClick={() => setTool('magic')} disabled={!!busy} title="Highlight a region, then inpaint it with AI">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Magic
              </Button>
              <Button
                size="sm"
                variant={tool === 'restore' ? 'default' : 'outline'}
                className="flex-1 px-2 text-[11px]"
                onClick={() => { setTool('restore'); clearMask() }}
                disabled={!!busy || !restoreReady}
                title={restoreErr ?? 'Paint cloth back in from the original try-on image'}
              >
                <Brush className="mr-1 h-3.5 w-3.5" /> Restore
              </Button>
            </div>
            {tool === 'restore' && (
              <div className="-mt-1 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id="cloth-only"
                    checked={clothOnly}
                    onCheckedChange={v => { setClothOnly(v); setBlockedHint(false) }}
                    disabled={!!busy}
                    // Radix renders the Thumb as a <span>; the arbitrary variants shrink it to this
                    // dialog's scale without forking the shared Switch.
                    className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
                  />
                  <label htmlFor="cloth-only" className="cursor-pointer text-[10.5px] font-medium">Cloth only</label>
                  {clothOnly && gateSource === 'color' && (
                    <span
                      className="rounded bg-amber-500/15 px-1 text-[9.5px] text-amber-600"
                      title="The pipeline's garment mask wasn't available for this job, so the brush is gated on colour alone — it may let some background through."
                    >
                      colour only
                    </span>
                  )}
                  <Button
                    size="icon"
                    variant={preview ? 'default' : 'outline'}
                    className="ml-auto h-6 w-6"
                    onClick={() => setPreview(p => !p)}
                    disabled={!clothOnly || !!busy}
                    title="Show where the brush is blocked"
                  >
                    <Eye className="h-3 w-3" />
                  </Button>
                </div>
                {blockedHint ? (
                  <p className="text-[10px] leading-tight text-amber-600">
                    Nothing to restore there — the garment mask says that area isn&apos;t cloth.{' '}
                    <button className="underline underline-offset-2" onClick={() => { setClothOnly(false); setBlockedHint(false) }}>
                      Paint it anyway
                    </button>
                  </p>
                ) : (
                  <p className="text-[10px] leading-tight text-muted-foreground">
                    {clothOnly
                      ? 'Only paints cloth back in — strokes over skin or the backdrop do nothing. Turn off if it refuses somewhere it shouldn’t.'
                      : 'Paints anything from the original back in, background included — clean up with Erase.'}
                  </p>
                )}
              </div>
            )}

            {/* Brush + zoom */}
            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-center gap-2">
                <span className="w-14 shrink-0 text-[10.5px] text-muted-foreground">Brush {brush}</span>
                <Slider value={[brush]} min={2} max={120} step={1} onValueChange={([v]) => setBrush(v)} className="flex-1" />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))} disabled={zoom <= ZOOM_MIN || !!busy} title="Zoom out">
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="w-9 text-center text-[10.5px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))} disabled={zoom >= ZOOM_MAX || !!busy} title="Zoom in">
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Undo / redo / reset + erase + back/save */}
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" className="h-7 w-7" onClick={undo} disabled={(!canUndo && !hasMask) || !!busy} title={hasMask ? 'Clear highlight' : 'Undo'}>
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="outline" className="h-7 w-7" onClick={redo} disabled={!canRedo || !!busy} title="Redo">
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="outline" className="h-7 w-7" onClick={resetOriginal} disabled={!canUndo || !!busy} title="Reset to original">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              {tool === 'magic' && (
                <>
                  {hasMask && (
                    <Button size="sm" variant="outline" className="ml-1" onClick={clearMask} disabled={!!busy} title="Revert the highlight">
                      <X className="mr-1 h-3.5 w-3.5" /> Clear
                    </Button>
                  )}
                  <Button size="sm" className="ml-1" onClick={runErase} disabled={!hasMask || !!busy}>
                    {busy === 'magic' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                    Erase
                  </Button>
                </>
              )}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => { clearMask(); setMode('view') }} disabled={!!busy}>
                  Back
                </Button>
                <Button size="sm" onClick={save} disabled={!!busy}>
                  {busy === 'save' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
