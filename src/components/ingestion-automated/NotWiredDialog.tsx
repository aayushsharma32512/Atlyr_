import { useState, useCallback, useMemo } from 'react'
import { Construction } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Every action in the design handoff that has no backing route yet (retag, delete,
// field-patch save, placement save, excel import, gen/seg re-upload, mask editor)
// routes here instead of silently no-op-ing or pretending to succeed.
export function useNotWiredDialog() {
  const [state, setState] = useState<{ label: string; detail?: string } | null>(null)

  const notify = useCallback((label: string, detail?: string) => setState({ label, detail }), [])

  const dialog = useMemo(() => (
    <Dialog open={state !== null} onOpenChange={(o) => !o && setState(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Construction className="h-4 w-4 text-muted-foreground" />
            <DialogTitle className="text-sm">Not wired up yet</DialogTitle>
          </div>
          <DialogDescription className="text-xs pt-1">
            <span className="font-medium text-foreground">{state?.label}</span> has no backend
            endpoint in <code className="text-[11px]">services/ingestion-automated</code> yet.
            {state?.detail ? <span className="block mt-1.5">{state.detail}</span> : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => setState(null)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ), [state])

  return { notify, dialog }
}
