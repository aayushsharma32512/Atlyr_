import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { resolveByProductId, type JobLinkRow } from './productJobLink'

/**
 * What the segmentation editor needs for one product: the cutout it edits, the original frame
 * Restore copies pixels out of, and the job id it saves against. Exactly the three fields
 * SegmentEraserDialog reads — nothing wider, so the dialog can be opened from the product side
 * without the caller owning a whole PipelineJob.
 */
export type ProductSegmentation = {
  job_id: string
  segmented_image_url: string | null
  vton_image_url: string | null
  /** Present only for published jobs; the editor reads it to decide whether placement can be re-run. */
  ingested_product_id: string | null
}

type Row = JobLinkRow & {
  segmented_image_url: string | null
  vton_image_url: string | null
}

/**
 * Segmentation assets for catalog products, keyed by product id.
 *
 * Products with no entry are those with no pipeline job behind them at all — legacy bulk-imported
 * catalog rows, and footwear/accessories, which never go through VTON. Callers should hide the
 * edit control for those rather than render one that cannot work.
 *
 * Only jobs that actually HAVE a cutout are fetched: without `segmented_image_url` there is
 * nothing to erase, and offering the tool would open an empty canvas.
 */
export function useProductSegmentation(productIds: string[]): Record<string, ProductSegmentation> {
  const [map, setMap] = useState<Record<string, ProductSegmentation>>({})

  // Sorted + joined so the effect is keyed on set membership, not array identity or order.
  const key = [...productIds].sort().join(',')

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) { setMap({}); return }
    let cancelled = false

    ;(async () => {
      // sha1 is one-way, so we cannot derive job ids from the products on screen — we pull the
      // jobs that have a cutout and hash their ids to find the matches.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ingestion_pipeline_jobs')
        .select('job_id, ingested_product_id, segmented_image_url, vton_image_url')
        .not('segmented_image_url', 'is', null)
      if (cancelled) return
      if (error) {
        // Surfaced rather than swallowed: a missing edit button otherwise looks identical whether
        // the product has no cutout or the query was rejected outright.
        console.warn('[useProductSegmentation] jobs lookup failed:', error.message)
        setMap({})
        return
      }

      const byProduct = await resolveByProductId((data ?? []) as Row[], new Set(ids))
      if (cancelled) return

      const next: Record<string, ProductSegmentation> = {}
      for (const [productId, row] of Object.entries(byProduct)) {
        next[productId] = {
          job_id: row.job_id,
          segmented_image_url: row.segmented_image_url,
          vton_image_url: row.vton_image_url,
          ingested_product_id: row.ingested_product_id,
        }
      }
      setMap(next)
    })()

    return () => { cancelled = true }
  }, [key])

  return map
}
