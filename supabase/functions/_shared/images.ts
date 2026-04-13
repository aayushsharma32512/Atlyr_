// @ts-nocheck
/* eslint-disable */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(supabaseUrl, supabaseServiceKey)
}

type ProductImage = {
  id: string
  product_id: string
  kind: string
  url?: string | null
  is_primary?: boolean | null
  gender?: string | null
  sort_order?: number | null
  vto_eligible?: boolean | null
}

export async function selectDeterministicModelImage(productId: string, gender?: string | null) {
  const supabase = await getSupabaseAdmin()
  const { data, error } = await supabase
    .from('product_images')
    .select('id, product_id, kind, url, is_primary, gender, sort_order, vto_eligible')
    .eq('product_id', productId)
    .eq('kind', 'model')
    .eq('vto_eligible', true)
  if (error) throw new Error(`[selectDeterministicModelImage] ${error.message}`)
  const candidates = (data as ProductImage[]) || []
  console.log('[selectDeterministicModelImage] fetched model candidates', {
    productId,
    requestedGender: gender || null,
    count: candidates.length,
    candidateIds: candidates.map(c => c.id),
  })
  if (candidates.length === 0) {
    console.log('[selectDeterministicModelImage] no vto_eligible model candidates', { productId })
  } else {
    const withPrimary = candidates.filter((c) => c.is_primary)
    const poolA = withPrimary.length > 0 ? withPrimary : candidates

    const byGender = gender ? poolA.filter((c) => (c.gender || null) === gender || (c.gender || null) === 'unisex') : poolA
    const poolB = byGender.length > 0 ? byGender : poolA

    const sorted = [...poolB].sort((a, b) => {
      const soA = a.sort_order ?? Number.MAX_SAFE_INTEGER
      const soB = b.sort_order ?? Number.MAX_SAFE_INTEGER
      if (soA !== soB) return soA - soB
      return (a.id < b.id ? -1 : 1)
    })
    const chosen = sorted[0]
    if (chosen) {
      const resolved = resolvePublicUrl(chosen.url || '')
      console.log('[selectDeterministicModelImage] using candidate image', {
        productId,
        chosenId: chosen.id,
        rawUrl: chosen.url || null,
        resolvedUrl: resolved,
      })
      if (resolved) {
        return { ...chosen, url: resolved }
      }
      console.warn('[selectDeterministicModelImage] chosen candidate unresolved', {
        productId,
        chosenId: chosen.id,
        rawUrl: chosen.url || null,
      })
    }
  }

  // Fallback: use product.image_url when no VTO-eligible model image is available
  const { data: productRow, error: productError } = await supabase
    .from('products')
    .select('image_url, gender')
    .eq('id', productId)
    .single()
  if (productError) {
    console.warn('[selectDeterministicModelImage] fallback product lookup failed', { productId, error: productError.message })
    return null
  }
  console.log('[selectDeterministicModelImage] attempting fallback', {
    productId,
    rawImageUrl: productRow?.image_url || null,
    productGender: productRow?.gender || null,
  })
  const fallbackUrl = resolvePublicUrl(productRow?.image_url || '')
  if (!fallbackUrl) {
    console.warn('[selectDeterministicModelImage] fallback image_url unresolved', { productId, rawImageUrl: productRow?.image_url || null })
    return null
  }
  console.log('[selectDeterministicModelImage] using fallback image_url', { productId, fallbackUrl })
  return {
    id: `product:${productId}`,
    product_id: productId,
    kind: 'product_image',
    url: fallbackUrl,
    is_primary: true,
    gender: productRow?.gender || null,
    sort_order: null,
    vto_eligible: false,
  }
}

export function flatlayFromProductImageUrl(product: { image_url?: string | null }) {
  const u = product?.image_url || null
  return u ? resolvePublicUrl(u) : null
}

function resolvePublicUrl(u: string): string | null {
  if (!u) return null
  if (/^https?:\/\//i.test(u)) return u
  const base = Deno.env.get('PUBLIC_ASSETS_BASE_URL') || ''
  if (!base) return null
  const sep = base.endsWith('/') || u.startsWith('/') ? '' : '/'
  return `${base}${sep}${u}`
}


