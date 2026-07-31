import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob } from '@/utils/ingestionV2Api'

export type Accordion = { title: string; content: string }

export type ProductMeta = {
  name: string | null
  brand: string | null
  price: number | null    // displayed as-is — see formatPrice
  currency: string | null
  // The rest of crawl_meta — read-only, surfaced in the row's expand panel. These come free:
  // the query below already pulls the whole artifact blob.
  description: string | null
  color: string | null       // null on the Shopify .js scrape path — only Firecrawl extracts it
  care: string | null
  accordions: Accordion[]
  finalUrl: string | null    // resolved after redirects; job.product_url is what was submitted
  siteProfile: string | null
  scrapedAt: string | null
  uploadedCount: number | null
  rawImageCount: number | null
}

// accordions is untyped JSONB — keep only well-formed {title, content} entries.
function parseAccordions(value: unknown): Accordion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const { title, content } = entry as Record<string, unknown>
    if (typeof title !== 'string' || typeof content !== 'string') return []
    return [{ title, content }]
  })
}

// crawl_meta is written once by the scraping step (services/ingestion-automated/src/steps/
// scraping.handler.ts) — same batch-in-one-query pattern as useSourceImages. The key includes
// updated_at so we refetch when a job advances (e.g. the scrape completing and writing
// crawl_meta after the row first appeared) — keying on job_id alone left the fields stale at
// "—" until a hard reload. The explicit refetch() additionally covers PATCH /jobs/:jobId/details
// name/brand/price edits, which don't necessarily bump the job row's updated_at.
export function useProductMeta(jobs: PipelineJob[]): { products: Record<string, ProductMeta>; refetch: () => void } {
  const [map, setMap] = useState<Record<string, ProductMeta>>({})
  const [nonce, setNonce] = useState(0)
  const ids = jobs.map(j => j.job_id)
  const key = jobs.map(j => `${j.job_id}:${j.updated_at}`).join(',')

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
      const rawImages = row.data?.raw_image_urls
      next[row.job_id] = {
        name: (row.data?.product_name as string | undefined) ?? null,
        brand: (row.data?.brand as string | undefined) ?? null,
        price: (row.data?.price as number | undefined) ?? null,
        currency: (row.data?.currency as string | undefined) ?? null,
        description: (row.data?.description as string | undefined) ?? null,
        color: (row.data?.color as string | undefined) ?? null,
        care: (row.data?.care as string | undefined) ?? null,
        accordions: parseAccordions(row.data?.accordions),
        finalUrl: (row.data?.final_url as string | undefined) ?? null,
        siteProfile: (row.data?.site_profile as string | undefined) ?? null,
        scrapedAt: (row.data?.scraped_at as string | undefined) ?? null,
        uploadedCount: (row.data?.uploaded_count as number | undefined) ?? null,
        rawImageCount: Array.isArray(rawImages) ? rawImages.length : null,
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
