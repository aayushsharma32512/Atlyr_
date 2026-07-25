import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Sparkles, Undo2, Redo2, Loader2, Pencil, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { v2Api, type PipelineJob } from '@/utils/ingestionV2Api'
import { magicErase, warmUpEraser } from '@/utils/eraserApi'

type Props = {
  job: PipelineJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful in-place save. */
  onSaved: () => void
}

type Mode = 'view' | 'edit'
type Tool = 'hard' | 'magic'

const MAX_HISTORY = 25
const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

// White = erase. Pink overlay only for on-screen feedback in magic mode.
const MASK_COLOR = 'rgba(236, 72, 153, 0.55)'

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
  // Bumped whenever history changes so undo/redo button disabled-states re-render.
  const [, setHistVer] = useState(0)

  const history = useRef<ImageData[]>([])
  const histIdx = useRef(-1)
  const drawing = useRef(false)
  const lastPt = useRef<{ x: number; y: number } | null>(null)
  const naturalRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const rectRef = useRef<DOMRect | null>(null)          // cached stage rect for the active stroke
  const cursorRef = useRef<HTMLDivElement>(null)         // brush cursor moved imperatively (no re-render)

  // Fit the image into the space left after the title + controls so the whole dialog
  // shows at once — no scrolling to reach the tools. Edit mode reserves more for its rows.
  const computeDisp = useCallback((editMode: boolean) => {
    const n = naturalRef.current
    if (!n.w || !n.h) return
    const reserve = editMode ? 220 : 120
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const maxH = Math.max(200, vh * 0.92 - reserve)
    const maxW = 512
    const ar = n.w / n.h
    let w = maxW, h = maxW / ar
    if (h > maxH) { h = maxH; w = maxH * ar }
    setDisp({ w: Math.round(w), h: Math.round(h) })
  }, [])

  const url = job?.segmented_image_url ?? null

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

  // (Re)load the source image into the canvas whenever the dialog opens.
  useEffect(() => {
    if (!open || !url) return
    setReady(false)
    setMode('view')
    setTool('hard')
    setZoom(1)
    warmUpEraser()   // start the Modal container so the first magic Erase isn't a cold start
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
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
    }
    img.onerror = () => toast({ title: 'Failed to load segmented image', variant: 'destructive' })
    img.src = url.includes('?') ? url : `${url}?cb=${Date.now()}`
  }, [open, url, pushHistory, toast, computeDisp])

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
  }
  const hideCursor = () => { if (cursorRef.current) cursorRef.current.style.display = 'none' }

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== 'edit' || busy) return
    const mc = maskCanvasRef.current!
    drawing.current = true
    mc.setPointerCapture(e.pointerId)
    const rect = mc.getBoundingClientRect()
    rectRef.current = rect
    lastPt.current = null
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
    if (tool === 'hard') pushHistory()   // one history entry per hard-erase stroke
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
            className="pointer-events-none fixed z-[9999] hidden rounded-full border border-white"
            style={{ width: brush, height: brush, transform: 'translate(-50%,-50%)', boxShadow: '0 0 0 1.5px rgba(0,0,0,0.55)' }}
          />,
          document.body,
        )}

        {/* Canvas stage — sized to fit the space left after the controls, so nothing scrolls.
            Only when zoomed >1 does the viewport bound + scroll to pan. */}
        <div className={cn('flex min-h-0 flex-1 items-center justify-center', zoom > 1 ? 'overflow-auto' : 'overflow-hidden')}>
          {!url ? (
            <div className="flex aspect-[4/5] w-[300px] items-center justify-center rounded-lg border border-border text-xs text-muted-foreground">No segmented image</div>
          ) : (
            <div
              className="relative shrink-0 origin-top rounded-lg border border-border bg-[repeating-conic-gradient(#e5e7eb_0_25%,#f3f4f6_0_50%)] bg-[length:16px_16px]"
              style={{ width: disp.w, height: disp.h, transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
            >
              <canvas ref={imageCanvasRef} className="absolute inset-0 h-full w-full" />
              <canvas
                ref={maskCanvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
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
              <Button size="sm" variant={tool === 'hard' ? 'default' : 'outline'} className="flex-1" onClick={() => { setTool('hard'); clearMask() }} disabled={!!busy}>
                <Eraser className="mr-1 h-3.5 w-3.5" /> Hard eraser
              </Button>
              <Button size="sm" variant={tool === 'magic' ? 'default' : 'outline'} className="flex-1" onClick={() => setTool('magic')} disabled={!!busy}>
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Magic eraser
              </Button>
            </div>

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
