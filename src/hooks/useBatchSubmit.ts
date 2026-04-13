import { useCallback, useState } from 'react'
import { submitJobsBatch, type BatchSubmitPayload, type BatchSubmitResponse } from '@/utils/ingestionApi'
import { useToast } from '@/hooks/use-toast'

export type BatchSubmitStatus = 'idle' | 'submitting' | 'success' | 'error'

type UseBatchSubmitOptions = {
  token?: string
}

type UseBatchSubmitReturn = {
  submit: (payload: BatchSubmitPayload) => Promise<BatchSubmitResponse | undefined>
  status: BatchSubmitStatus
  result?: BatchSubmitResponse
  error?: string | null
  reset: () => void
}

export function useBatchSubmit(options: UseBatchSubmitOptions = {}): UseBatchSubmitReturn {
  const { token } = options
  const [status, setStatus] = useState<BatchSubmitStatus>('idle')
  const [result, setResult] = useState<BatchSubmitResponse | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const reset = useCallback(() => {
    setStatus('idle')
    setResult(undefined)
    setError(null)
  }, [])

  const submit = useCallback(
    async (payload: BatchSubmitPayload) => {
      setStatus('submitting')
      setError(null)
      try {
        const response = await submitJobsBatch(payload, { token })
        setResult(response)
        setStatus('success')
        toast({
          title: 'Batch submitted',
          description: `${response.summary.enqueued ?? 0} enqueued · ${response.summary.duplicate ?? 0} duplicates`,
        })
        return response
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to submit batch'
        setError(message)
        setStatus('error')
        toast({ title: 'Batch submit failed', description: message, variant: 'destructive' })
        return undefined
      }
    },
    [toast, token]
  )

  return { submit, status, result, error, reset }
}
