import { useCallback, useMemo, useState } from 'react'
import { updatePhase1, Phase1UpdatePayload } from '@/utils/ingestionApi'
import { useToast } from '@/hooks/use-toast'

export type HitlPhase1SaveStatus = 'idle' | 'saving' | 'success' | 'error'

export type HitlPhase1Hook = {
  saveChanges: (jobId: string, patch: Phase1UpdatePayload['patch']) => Promise<void>
  completePhase: (jobId: string, patch?: Phase1UpdatePayload['patch']) => Promise<void>
  status: HitlPhase1SaveStatus
  error?: string | null
}

export function useHitlPhase1(token?: string): HitlPhase1Hook {
  const { toast } = useToast()
  const [status, setStatus] = useState<HitlPhase1SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(
    async (jobId: string, payload: Phase1UpdatePayload) => {
      setStatus('saving')
      setError(null)
      try {
        await updatePhase1(jobId, payload, { token })
        setStatus('success')
        toast({ title: 'Changes saved' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save changes'
        setStatus('error')
        setError(message)
        toast({ title: 'Save failed', description: message, variant: 'destructive' })
        throw err
      }
    },
    [toast, token]
  )

  const api = useMemo<HitlPhase1Hook>(() => ({
    status,
    error,
    async saveChanges(jobId, patch) {
      if (!patch) return
      await save(jobId, { patch })
    },
    async completePhase(jobId, patch) {
      await save(jobId, { patch, complete: true })
    },
  }), [status, error, save])

  return api
}
