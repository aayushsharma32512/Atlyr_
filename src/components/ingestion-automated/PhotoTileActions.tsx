import { useState } from 'react'
import { Pencil, Trash2, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { View, PhotoType } from './useImageClassification'

const VIEW_OPTIONS: View[] = ['Front', 'Back', 'Side']
const TYPE_OPTIONS: PhotoType[] = ['Model', 'Flat', 'Detail']

type Props = {
  defaultView: View
  defaultType: PhotoType
  onRetag: (view: View, type: PhotoType) => void
  onDelete: () => void
  busy?: boolean
}

// Inline pen (retag) + trash (delete) controls overlaid on a photo tile — the sleek,
// on-tile version of the actions that also live in the enlarged PhotoViewerDialog. The pen
// opens a compact retag popover; the trash defers to the caller (which shows a confirm).
export function PhotoTileActions({ defaultView, defaultType, onRetag, onDelete, busy }: Props) {
  const [view, setView] = useState<View>(defaultView)
  const [type, setType] = useState<PhotoType>(defaultType)
  const [open, setOpen] = useState(false)

  return (
    <div className="flex gap-0.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button title="Retag photo" className="rounded bg-black/60 p-1 text-white hover:bg-black/80">
            <Pencil className="h-2.5 w-2.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1">
              <Select value={view} onValueChange={v => setView(v as View)}>
                <SelectTrigger className="h-7 flex-1 text-xs [&>svg]:h-3 [&>svg]:w-3" disabled={type === 'Detail'}><SelectValue /></SelectTrigger>
                <SelectContent>{VIEW_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={type} onValueChange={v => setType(v as PhotoType)}>
                <SelectTrigger className="h-7 flex-1 text-xs [&>svg]:h-3 [&>svg]:w-3"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPE_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => { onRetag(view, type); setOpen(false) }}>
              {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <button title="Delete photo" onClick={onDelete} className="rounded bg-black/60 p-1 text-white hover:bg-destructive">
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}
