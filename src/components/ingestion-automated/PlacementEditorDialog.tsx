import { useState, useEffect, type KeyboardEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import type { PipelineJob } from '@/utils/ingestionV2Api'
import { jobThumbnail } from './imageUrl'
import { useNotWiredDialog } from './NotWiredDialog'

type PlacementValue = { scale: number; x: number; y: number }
const DEFAULT_PLACEMENT: PlacementValue = { scale: 100, x: 0, y: 8 }

type Props = {
  job: PipelineJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Row({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] text-muted-foreground w-10 shrink-0">{label}</span>
      <Slider value={[value]} min={min} max={max} step={1} onValueChange={([v]) => onChange(v)} className="flex-1" />
      <Input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-6 w-14 text-[10.5px] px-1.5"
      />
    </div>
  )
}

export function PlacementEditorDialog({ job, open, onOpenChange }: Props) {
  const [pl, setPl] = useState<PlacementValue>(DEFAULT_PLACEMENT)
  const { notify, dialog } = useNotWiredDialog()

  useEffect(() => { if (open) setPl(DEFAULT_PLACEMENT) }, [open, job?.job_id])

  if (!job) return null
  const url = jobThumbnail(job)

  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setPl(p => ({ ...p, x: Math.max(-120, p.x - step) })) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPl(p => ({ ...p, x: Math.min(120, p.x + step) })) }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setPl(p => ({ ...p, y: Math.max(-120, p.y - step) })) }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setPl(p => ({ ...p, y: Math.min(120, p.y + step) })) }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Placement editor</DialogTitle>
        </DialogHeader>

        <div className="flex gap-5">
          {/* Left: generated output */}
          <div className="w-[186px] shrink-0 flex flex-col gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Generated</p>
              <div className="rounded-lg border border-border bg-muted aspect-[3/4] overflow-hidden flex items-center justify-center">
                {url ? <img src={url} alt="Generated" className="w-full h-full object-contain" /> : <span className="text-[10px] text-muted-foreground">Not yet</span>}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Placement applies to the current generated + segmented pair. No front/back split exists
              in this pipeline yet — a single placement is stored per job.
            </p>
          </div>

          {/* Right: avatar canvas + controls */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Segmented garment over avatar</p>
              <button onClick={() => setPl(DEFAULT_PLACEMENT)} className="flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground">
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>

            <div
              tabIndex={0}
              onKeyDown={nudge}
              className="relative h-[260px] rounded-lg border border-border bg-muted/40 overflow-hidden outline-none focus:ring-2 focus:ring-ring"
            >
              {/* crude avatar silhouette */}
              <div className="absolute left-1/2 top-[14%] -translate-x-1/2 h-10 w-10 rounded-full bg-muted-foreground/20" />
              <div className="absolute left-1/2 top-[30%] -translate-x-1/2 h-24 w-16 rounded-md bg-muted-foreground/20" />
              <div className="absolute left-[42%] top-[58%] h-20 w-6 rounded-md bg-muted-foreground/20" />
              <div className="absolute left-[54%] top-[58%] h-20 w-6 rounded-md bg-muted-foreground/20" />

              {url && (
                <img
                  src={url}
                  alt="Segmented garment"
                  className="absolute left-1/2 top-1/2 w-20 object-contain pointer-events-none"
                  style={{ transform: `translate(-50%, -50%) translate(${pl.x}px, ${pl.y}px) scale(${pl.scale / 100})` }}
                />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">Arrow keys nudge position — hold Shift to move ×5.</p>

            <Row label="Scale" value={pl.scale} min={40} max={160} onChange={v => setPl(p => ({ ...p, scale: v }))} />
            <Row label="X" value={pl.x} min={-120} max={120} onChange={v => setPl(p => ({ ...p, x: v }))} />
            <Row label="Y" value={pl.y} min={-120} max={120} onChange={v => setPl(p => ({ ...p, y: v }))} />
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => notify('Save placement', 'The /jobs/:jobId/placement route referenced in the state machine has not been implemented yet.')}>
            Save placement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {dialog}
    </>
  )
}
