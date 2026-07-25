import { useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { View, PhotoType } from './useImageClassification'
import { ConfirmDialog } from './ConfirmDialog'

export type ViewerImage = { url: string; label: string; note?: string }

type Props = {
  images: ViewerImage[]
  index: number
  onIndexChange: (i: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  // Optional photo actions — only rendered when provided (i.e. the images belong to a job
  // whose photos can be retagged/deleted). Retag corrects a mis-classification (a manual tag
  // always outranks the model); Delete soft-removes a photo and recomputes the VTON slots.
  jobId?: string
  preferredUrl?: string | null
  onRetag?: (url: string, view: View, type: PhotoType) => Promise<void> | void
  onDeletePhoto?: (url: string) => Promise<void> | void
}

const VIEW_OPTIONS: View[] = ['Front', 'Back', 'Side']
const TYPE_OPTIONS: PhotoType[] = ['Model', 'Flat', 'Detail']

export function PhotoViewerDialog({
  images, index, onIndexChange, open, onOpenChange, jobId, preferredUrl, onRetag, onDeletePhoto,
}: Props) {
  const [draftView, setDraftView] = useState<View>('Front')
  const [draftType, setDraftType] = useState<PhotoType>('Model')
  const [busy, setBusy] = useState<null | 'retag' | 'delete'>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const img = images[index]
  if (!img) return null

  const canAct = !!jobId && (!!onRetag || !!onDeletePhoto)
  const isPreferred = !!preferredUrl && img.url === preferredUrl
  const isLast = images.length <= 1

  const applyRetag = async () => {
    if (!onRetag) return
    setBusy('retag')
    try { await onRetag(img.url, draftView, draftType) } finally { setBusy(null) }
  }

  const applyDelete = async () => {
    if (!onDeletePhoto) return
    setBusy('delete')
    try { await onDeletePhoto(img.url) } finally { setBusy(null) }
  }

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

          {/* Retag + Delete — corrects a wrong classification / removes a junk photo */}
          {canAct && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2">
              {onRetag && (
                <div className="flex items-center gap-1.5">
                  <Select value={draftView} onValueChange={v => setDraftView(v as View)}>
                    <SelectTrigger className="h-7 flex-1 text-xs [&>svg]:h-3 [&>svg]:w-3" disabled={draftType === 'Detail'}><SelectValue /></SelectTrigger>
                    <SelectContent>{VIEW_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={draftType} onValueChange={v => setDraftType(v as PhotoType)}>
                    <SelectTrigger className="h-7 flex-1 text-xs [&>svg]:h-3 [&>svg]:w-3"><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPE_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" className="h-7 text-xs" disabled={busy !== null} onClick={applyRetag} title="Make this the photo for the chosen slot">
                    {busy === 'retag' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Retag
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] text-muted-foreground">
                  {isPreferred ? '★ Current try-on pick' : ''}
                </span>
                {onDeletePhoto && (
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    disabled={busy !== null}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {busy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                    Delete photo
                  </Button>
                )}
              </div>
            </div>
          )}

          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this photo?"
        description={
          isPreferred || isLast
            ? `This is the item's ${isPreferred ? 'current try-on pick' : 'only usable photo'}. Deleting it leaves nothing for generation and the item will need a re-scrape. If it's just mis-classified, use Retag instead of deleting.`
            : 'Removes this photo from the item and recomputes the try-on slots. It cannot be undone.'
        }
        confirmLabel="Delete photo"
        destructive
        onConfirm={applyDelete}
      />
    </Dialog>
  )
}
