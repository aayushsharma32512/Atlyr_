import { useCallback, useMemo, useState } from 'react'
import { updatePhase2, Phase2UpdatePayload } from '@/utils/ingestionApi'
import { useToast } from '@/hooks/use-toast'

export type HitlPhase2Action = 'save' | 'approve' | 'regenerate'
export type HitlPhase2Status = 'idle' | 'saving' | 'approving' | 'regenerating' | 'success' | 'error'

export type HitlPhase2Hook = {
  status: HitlPhase2Status
  lastAction?: HitlPhase2Action
  error?: string | null
  saveChanges: (jobId: string, patch: Phase2UpdatePayload['patch']) => Promise<void>
  approve: (jobId: string, patch?: Phase2UpdatePayload['patch']) => Promise<void>
  regenerate: (jobId: string, node: 'ghost' | 'garment_summary' | 'enrich', data?: Record<string, unknown>) => Promise<void>
}

export function useHitlPhase2(token?: string): HitlPhase2Hook {
  const { toast } = useToast()
  const [status, setStatus] = useState<HitlPhase2Status>('idle')
  const [lastAction, setLastAction] = useState<HitlPhase2Action | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const send = useCallback(
    async (jobId: string, payload: Phase2UpdatePayload, nextStatus: HitlPhase2Status, action: HitlPhase2Action, successMessage: string) => {
      setStatus(nextStatus)
      setLastAction(action)
      setError(null)
      try {
        await updatePhase2(jobId, payload, { token })
        setStatus('success')
        toast({ title: successMessage })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update job'
        setStatus('error')
        setError(message)
        toast({ title: 'Action failed', description: message, variant: 'destructive' })
        throw err
      }
    },
    [toast, token]
  )

  const api = useMemo<HitlPhase2Hook>(() => ({
    status,
    lastAction,
    error,
    async saveChanges(jobId, patch) {
      if (!patch) return
      await send(jobId, { patch }, 'saving', 'save', 'Changes saved')
    },
    async approve(jobId, patch) {
      await send(jobId, { patch, action: 'approve' }, 'approving', 'approve', 'Approval submitted')
    },
    async regenerate(jobId, node, data) {
      await send(jobId, { action: 'regenerate', node, data }, 'regenerating', 'regenerate', 'Regeneration requested')
    },
  }), [status, lastAction, error, send])

  return api
}
