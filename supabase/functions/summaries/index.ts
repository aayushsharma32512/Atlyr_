// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { requireUser, corsHeaders } from "../_shared/auth.ts"
import { GARMENT_SUMMARY_VERSION, DESC_MODEL } from "../_shared/versions.ts"
import { selectDeterministicModelImage, flatlayFromProductImageUrl } from "../_shared/images.ts"
import { generateJson, toInlineImagePartFromUrl } from "../_shared/gemini.ts"
import { SYSTEM_INSTRUCTION_DESC, PROMPT_DESC } from "../_shared/prompts.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { correlationId, userId } = await requireUser(req)
  if (!userId) {
    return new Response(JSON.stringify({ status: 'error', code: 'E_NO_USER', correlationId }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const url = new URL(req.url)
    const pathname = url.pathname

    if (req.method === 'POST' && pathname.endsWith('/precheck')) {
      console.log('[Summaries][Precheck] start', { correlationId, userId })
      const { products, requiredVersion } = await req.json()
      if (!Array.isArray(products) || products.length === 0) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', correlationId }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const version = requiredVersion || GARMENT_SUMMARY_VERSION

      const ctx = await requireUser(req)
      const supabase = ctx.adminClient
      const detailsMissing: any[] = []
      const assets: any = {}
      let needsCompute = false

      for (const p of products) {
        const { data: prod } = await supabase.from('products').select('id, image_url, garment_summary, garment_summary_version').eq('id', p.id).single()
        const hasValid = !!prod?.garment_summary && prod?.garment_summary_version === version
        if (!hasValid) needsCompute = true

        const modelImage = await selectDeterministicModelImage(p.id, p.gender || null)
        const flatlay = flatlayFromProductImageUrl(prod || {})
        const missing = [] as string[]
        if (!modelImage) missing.push('model')
        if (!flatlay && !hasValid) missing.push('flatlay')
        if (missing.length > 0) {
          detailsMissing.push({ productId: p.id, missing })
        } else {
          assets[p.type] = { model: modelImage?.url || null, flatlay: flatlay || null }
        }
      }

      if (detailsMissing.length > 0) {
        return new Response(JSON.stringify({ status: 'missing_assets', details: detailsMissing, correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      return new Response(JSON.stringify({ status: 'ok', needsCompute, assets, correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (req.method === 'POST' && pathname.endsWith('/compute')) {
      console.log('[Summaries][Compute] start', { correlationId, userId })
      const started = Date.now()
      const { top, bottom, version, temps } = await req.json()
      console.log('[Summaries][Compute] payload', {
        correlationId,
        hasTop: !!top,
        hasBottom: !!bottom,
        topInfo: top ? { productId: top.productId, flatlayUrl: top.flatlayUrl, modelUrl: top.modelUrl } : null,
        bottomInfo: bottom ? { productId: bottom.productId, flatlayUrl: bottom.flatlayUrl, modelUrl: bottom.modelUrl } : null
      })
      if (!top && !bottom) {
        console.warn('[Summaries][Compute] no items provided', { correlationId })
        return new Response(JSON.stringify({ status: 'error', code: 'E_NO_ITEMS', correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const finalVersion = version || GARMENT_SUMMARY_VERSION
      const ctx = await requireUser(req)
      const supabase = ctx.adminClient

      const updated: any[] = []
      const entries = [ ['top', top], ['bottom', bottom] ] as const
      for (const [key, item] of entries) {
        if (!item) continue
        const { productId } = item
        // Build parts: flatlay first if available, then model, then the instruction
        const parts: any[] = []
        if (item.flatlayUrl) {
          try {
            parts.push(await toInlineImagePartFromUrl(item.flatlayUrl))
          } catch (e) {
            console.error('[Summaries][Compute] flatlay fetch error', { correlationId, productId, url: item.flatlayUrl, err: (e as Error).message })
          }
        }
        if (item.modelUrl) {
          try {
            parts.push(await toInlineImagePartFromUrl(item.modelUrl))
          } catch (e) {
            console.error('[Summaries][Compute] model fetch error', { correlationId, productId, url: item.modelUrl, err: (e as Error).message })
          }
        }
        parts.push({ text: `${PROMPT_DESC}\n\nCategory: ${key}` })

        let text = ''
        try {
          text = await generateJson({ modelName: DESC_MODEL, systemInstruction: SYSTEM_INSTRUCTION_DESC, temperature: temps?.desc_temp ?? 0.2, seed: temps?.seed ?? 7, parts })
        } catch (e) {
          console.error('[Summaries][Compute] descriptor error', { correlationId, productId, err: (e as Error).message })
        }

        let summary: any
        try {
          summary = JSON.parse(text || '{}')
          if (!summary || typeof summary !== 'object') summary = { category: key, raw_summary: text || '' }
        } catch {
          summary = { category: key, raw_summary: text || '' }
        }
        const { data: updatedRows, error } = await supabase
          .from('products')
          .update({ garment_summary: summary, garment_summary_version: finalVersion })
          .eq('id', productId)
          .select('id')
        if (error) {
          console.error('[Summaries][Compute] upsert error', { correlationId, productId, error: error.message })
          continue
        }
        if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
          console.warn('[Summaries][Compute] no rows matched for update', { correlationId, productId })
          // Fallback: some clients pass display name instead of primary key; try matching on `text`
          const { data: fallbackRows, error: fbErr } = await supabase
            .from('products')
            .update({ garment_summary: summary, garment_summary_version: finalVersion })
            .eq('text', productId)
            .select('id')
          if (fbErr) {
            console.error('[Summaries][Compute] fallback update error', { correlationId, productId, error: fbErr.message })
            continue
          }
          if (!fallbackRows || (Array.isArray(fallbackRows) && fallbackRows.length === 0)) {
            console.warn('[Summaries][Compute] fallback also matched 0 rows', { correlationId, productId })
            continue
          }
          console.log('[Summaries][Compute] upserted via fallback', { correlationId, productId, version: finalVersion })
        }
        console.log('[Summaries][Compute] upserted', { correlationId, productId, version: finalVersion, hasRaw: !!summary?.raw_summary })
        updated.push({ productId, version: finalVersion })
      }

      const durationMs = Date.now() - started
      return new Response(JSON.stringify({ status: 'ok', updated, correlationId, durationMs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Not found', correlationId }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('[Summaries] error', { correlationId: (await requireUser(req)).correlationId, error: (error as Error).message })
    return new Response(JSON.stringify({ status: 'error', code: 'E_INTERNAL', message: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})


