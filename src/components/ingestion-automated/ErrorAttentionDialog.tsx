import { useState } from 'react'
import { AlertCircle, Flag } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { v2Api, type PipelineJob } from '@/utils/ingestionV2Api'
import { canProceed, attentionNote } from './stateMapping'
import { useNotWiredDialog } from './NotWiredDialog'

type Props = {
  job: PipelineJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenPlacement: (jobId: string) => void
  refetch: () => void
}

export function ErrorAttentionDialog({ job, open, onOpenChange, onOpenPlacement, refetch }: Props) {
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const { notify, dialog: notWiredDialog } = useNotWiredDialog()

  if (!job) return null

  const isError = job.current_state === 'failed'
  const note = attentionNote(job)

  const handleRestart = async () => {
    const from = job.last_error_step ?? 'scraping'
    setBusy(true)
    try {
      await v2Api.restart(job.job_id, from)
      toast({ title: `Restarted from ${from}` })
      onOpenChange(false)
      refetch()
    } catch (e) {
      toast({ title: 'Restart failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const handleProceed = async () => {
    setBusy(true)
    try {
      const res = await v2Api.proceed(job.job_id, {})
      toast({ title: 'Pushed', description: `→ ${res.current_state}` })
      onOpenChange(false)
      refetch()
    } catch (e) {
      toast({ title: 'Push failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[430px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {isError
              ? <AlertCircle className="h-4 w-4 text-destructive" />
              : <Flag className="h-4 w-4 text-amber-600" />}
            <DialogTitle className="text-sm">{isError ? 'Job failed' : 'Needs review'}</DialogTitle>
          </div>
          <DialogDescription className="text-xs pt-1">{job.product_url}</DialogDescription>
        </DialogHeader>

        {isError ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Failed at <span className="font-medium text-foreground">{job.last_error_step ?? job.current_state}</span> — {job.error_count} attempt(s)
            </p>
            {job.last_error && (
              <pre className="text-[10.5px] font-mono bg-muted rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">{job.last_error}</pre>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{note}</p>
        )}

        <DialogFooter className="gap-1.5">
          <Button size="sm" variant="outline" onClick={() => notify('Discard item')}>Discard</Button>
          {isError && (
            <Button size="sm" variant="destructive" onClick={handleRestart} disabled={busy}>
              ↻ Restart from {job.last_error_step ?? 'scraping'}
            </Button>
          )}
          {!isError && job.current_state === 'placement' && (
            <Button size="sm" onClick={() => { onOpenChange(false); onOpenPlacement(job.job_id) }}>
              Open placement editor
            </Button>
          )}
          {!isError && canProceed(job) && (
            <Button size="sm" onClick={handleProceed} disabled={busy}>Proceed →</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {notWiredDialog}
    </>
  )
}
