import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type ViewerImage = { url: string; label: string; note?: string }

type Props = {
  images: ViewerImage[]
  index: number
  onIndexChange: (i: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PhotoViewerDialog({ images, index, onIndexChange, open, onOpenChange }: Props) {
  const img = images[index]
  if (!img) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle className="sr-only">{img.label}</DialogTitle>
        <div className="flex flex-col gap-3">
          <div className="relative rounded-lg border border-border bg-muted overflow-hidden flex items-center justify-center aspect-[4/5]">
            <img src={img.url} alt={img.label} className="w-full h-full object-contain" />
            <a
              href={img.url} target="_blank" rel="noopener noreferrer"
              className="absolute top-2 right-2 bg-black/60 rounded p-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5 text-white" />
            </a>
            {images.length > 1 && (
              <>
                <button
                  onClick={() => onIndexChange((index - 1 + images.length) % images.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5"
                >
                  <ChevronLeft className="h-4 w-4 text-white" />
                </button>
                <button
                  onClick={() => onIndexChange((index + 1) % images.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5"
                >
                  <ChevronRight className="h-4 w-4 text-white" />
                </button>
              </>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{img.label}</p>
              {img.note && <p className="text-xs text-muted-foreground">{img.note}</p>}
            </div>
            {images.length > 1 && (
              <span className="text-xs text-muted-foreground">{index + 1} / {images.length}</span>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
