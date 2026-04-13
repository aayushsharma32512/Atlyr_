import { useCallback, useState } from 'react'
import { vtoApi } from '@/utils/vtoApi'

export type VtoStep = 'neutral-pose' | 'asset-check' | 'summaries' | 'generate' | 'result'

export function useVtoFlow() {
  const [step, setStep] = useState<VtoStep>('neutral-pose')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<{
    uploadBatchId?: string
    neutralPoseId?: string
    topId?: string
    bottomId?: string | null
    resultUrl?: string
  }>({})

  const startAssetCheck = useCallback(async (args: { topId: string; bottomId?: string | null; neutralPoseId: string }) => {
    setError(null)
    setLoading(true)
    try {
      setContext(prev => ({ ...prev, ...args }))
      setStep('asset-check')
      const pre = await vtoApi.vtoPrecheck({ ...args })
      if (pre.status === 'ok') {
        setStep('generate')
        return { ready: true as const }
      }
      if (pre.status === 'summaries_outdated') {
        setStep('summaries')
        return { ready: false as const, reason: 'summaries_outdated' as const }
      }
      if (pre.status === 'missing_assets') {
        setError(`Missing assets: ${pre.details.join(', ')}`)
        return { ready: false as const, reason: 'missing_assets' as const }
      }
      return { ready: false as const, reason: 'unknown' as const }
    } catch (e) {
      setError((e as Error).message)
      return { ready: false as const, reason: 'error' as const }
    } finally {
      setLoading(false)
    }
  }, [])

  const computeSummaries = useCallback(async (args: {
    top: { productId: string; modelUrl?: string; flatlayUrl?: string }
    bottom?: { productId: string; modelUrl?: string; flatlayUrl?: string } | null
  }) => {
    setError(null)
    setLoading(true)
    try {
      setStep('summaries')
      await vtoApi.summariesCompute({ top: args.top, bottom: args.bottom ?? undefined })
      setStep('generate')
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const generate = useCallback(async (ids?: { topId: string; bottomId?: string | null; neutralPoseId: string; outfitSnapshot?: any }) => {
    const topId = ids?.topId ?? context.topId
    const bottomId = ids && Object.prototype.hasOwnProperty.call(ids, 'bottomId')
      ? ids.bottomId
      : context.bottomId
    const neutralPoseId = ids?.neutralPoseId ?? context.neutralPoseId
    if (!topId || !neutralPoseId) return null
    setError(null)
    setLoading(true)
    try {
      setStep('generate')
      const res = await vtoApi.vtoGenerate({ topId, bottomId, neutralPoseId, outfitSnapshot: ids?.outfitSnapshot })
      setContext(prev => ({ ...prev, resultUrl: res.signedUrl || '', bottomId }))
      setStep('result')
      return res
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setLoading(false)
    }
  }, [context.bottomId, context.neutralPoseId, context.topId])

  return {
    step,
    setStep,
    loading,
    error,
    context,
    setContext,
    startAssetCheck,
    computeSummaries,
    generate,
  }
}
