import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'

export type VtonReference = { url: string; label: string }

type JobRow = {
  job_id: string
  ingested_product_id: string | null
  vton_image_url: string | null
  v_ton_preferred_image: string | null
}

// products.id is a deterministic sha1 of the job id — see catalogId() in
// services/ingestion-automated/src/domain/catalog.ts. Hashing job ids lets us map job → product
// WITHOUT relying on ingested_product_id, which is only written on the publish path, so a job that
// was staged but never published would otherwise join to nothing.
// crypto.subtle needs a secure context; localhost and https both qualify.
async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// The try-on reference for a catalog product, keyed by product id — the same job data the
// ingestion dashboard's mesh editor shows, reached from the product side.
//
// Products with no entry are those with no pipeline job behind them at all: legacy bulk-imported
// catalog rows, and footwear/accessories, which the VTON adapter never generates for (it handles
// topwear/bottomwear/dress only). Callers fall back to their own "no reference" placeholder.
export function useProductVton(productIds: string[]): Record<string, VtonReference> {
  const [map, setMap] = useState<Record<string, VtonReference>>({})

  // Sorted + joined so the effect is keyed on set membership, not array identity or order.
  const key = [...productIds].sort().join(',')

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) { setMap({}); return }
    let cancelled = false

    ;(async () => {
      // 1) product_images is the richest source and needs no id gymnastics: the catalog publish
      //    path writes the try-on here as kind 'model' (domain/catalog.ts), and legacy catalog rows
      //    carry their on-model shots here too. This is what covers products with no pipeline job.
      const { data: imgData, error: imgError } = await supabase
        .from('product_images')
        .select('product_id, url, vto_eligible, sort_order')
        .in('product_id', ids)
        .eq('kind', 'model')
        .order('sort_order', { ascending: true })
      if (cancelled) return
      if (imgError) console.warn('[useProductVton] product_images lookup failed:', imgError.message)

      const fromImages: Record<string, VtonReference> = {}
      for (const row of (imgData ?? []) as { product_id: string; url: string | null; vto_eligible: boolean | null }[]) {
        if (!row.url) continue
        const existing = fromImages[row.product_id]
        // A vto-eligible row is the actual try-on; otherwise take the first model shot as a
        // weaker reference, and let a vto-eligible one replace it if we see one later.
        if (!existing) fromImages[row.product_id] = { url: row.url, label: row.vto_eligible ? 'Try-on' : 'Model photo' }
        else if (row.vto_eligible && existing.label !== 'Try-on') fromImages[row.product_id] = { url: row.url, label: 'Try-on' }
      }

      // 2) Fall back to the pipeline job for anything still unresolved. sha1 is one-way, so we
      //    can't derive job ids from the products on screen — we pull the jobs that have a
      //    reference image and hash their ids to find the matches.
      const stillMissing = ids.filter(id => !fromImages[id])
      if (stillMissing.length === 0) { setMap(fromImages); return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ingestion_pipeline_jobs')
        .select('job_id, ingested_product_id, vton_image_url, v_ton_preferred_image')
        .or('vton_image_url.not.is.null,v_ton_preferred_image.not.is.null')
      if (cancelled) return
      if (error) {
        // Surfaced rather than swallowed: an empty panel otherwise looks identical whether the
        // product has no try-on or the query was rejected outright.
        console.warn('[useProductVton] jobs lookup failed:', error.message)
        setMap(fromImages)
        return
      }
      if (!data) { setMap(fromImages); return }

      const wanted = new Set(stillMissing)
      const rows = data as JobRow[]
      // Same precedence + labels as the job-side editor: the generated try-on when it exists,
      // otherwise the scraped source photo, which is a weaker but still useful reference.
      const refOf = (r: JobRow): VtonReference | null =>
        r.vton_image_url ? { url: r.vton_image_url, label: 'Generated try-on' }
        : r.v_ton_preferred_image ? { url: r.v_ton_preferred_image, label: 'Source photo · no try-on generated' }
        : null

      const next: Record<string, VtonReference> = { ...fromImages }
      for (const r of rows) {
        const ref = refOf(r)
        if (!ref) continue
        // Cheap path first: the FK when it happens to be set.
        if (r.ingested_product_id && wanted.has(r.ingested_product_id)) next[r.ingested_product_id] = ref
      }
      // Then the derived id, which also covers never-published jobs.
      const unresolved = rows.filter(r => refOf(r) && (!r.ingested_product_id || !next[r.ingested_product_id]))
      const hashed = await Promise.all(unresolved.map(async r => [await sha1Hex(r.job_id), r] as const))
      if (cancelled) return
      for (const [productId, r] of hashed) {
        const ref = refOf(r)
        if (ref && wanted.has(productId) && !next[productId]) next[productId] = ref
      }

      setMap(next)
    })()

    return () => { cancelled = true }
  }, [key])

  return map
}
