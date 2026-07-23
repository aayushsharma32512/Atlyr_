import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'

export type ProductMeta = {
  name: string | null
  brand: string | null
  price: number | null    // displayed as-is — see formatPrice
  currency: string | null
}

// crawl_meta is written once by the scraping step (services/ingestion-automated/src/steps/
// scraping.handler.ts) — same batch-in-one-query pattern as useSourceImages. Explicit
// refetch() because PATCH /jobs/:jobId/details only touches crawl_meta for name/brand/price
// edits — it doesn't necessarily bump the job row's updated_at.
export function useProductMeta(jobs: PipelineJob[]): { products: Record<string, ProductMeta>; refetch: () => void } {
  const [map, setMap] = useState<Record<string, ProductMeta>>({})
  const [nonce, setNonce] = useState(0)
  const ids = jobs.map(j => j.job_id)
  const key = ids.join(',')

  const load = useCallback(async () => {
    if (ids.length === 0) { setMap({}); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('pipeline_step_artifacts')
      .select('job_id, data')
      .in('job_id', ids)
      .eq('artifact_type', 'crawl_meta')
      .order('created_at', { ascending: true })
    if (error || !data) return

    const next: Record<string, ProductMeta> = {}
    for (const row of data as { job_id: string; data: Record<string, unknown> | null }[]) {
      next[row.job_id] = {
        name: (row.data?.product_name as string | undefined) ?? null,
        brand: (row.data?.brand as string | undefined) ?? null,
        price: (row.data?.price as number | undefined) ?? null,
        currency: (row.data?.currency as string | undefined) ?? null,
      }
    }
    setMap(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => { load() }, [load, nonce])

  return { products: map, refetch: () => setNonce(n => n + 1) }
}

export function formatPrice(meta: ProductMeta): string | null {
  if (meta.price == null) return null
  const amount = meta.price
  if (!meta.currency) return amount.toFixed(2)
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: meta.currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${meta.currency} ${amount.toFixed(2)}`
  }
}
