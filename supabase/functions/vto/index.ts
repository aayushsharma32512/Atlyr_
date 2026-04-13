// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { requireUser, corsHeaders } from "../_shared/auth.ts"
import { selectDeterministicModelImage } from "../_shared/images.ts"
import { GARMENT_SUMMARY_VERSION } from "../_shared/versions.ts"
import { createSignedUrl, putObject } from "../_shared/storage.ts"
import { IMG_MODEL } from "../_shared/versions.ts"
import { generateImage, toInlineImagePartFromUrl } from "../_shared/gemini.ts"
import { SYSTEM_INSTRUCTION_TRYON, PROMPT_TRYON_TOPBOTTOM, PROMPT_TRYON_SINGLE } from "../_shared/prompts.ts"

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
      console.log('[VTO][Precheck] start', { correlationId, userId })
      const { topId, bottomId, neutralPoseId, requireSummariesVersion } = await req.json()
      const hasBottom = !!bottomId
      console.log('[VTO][Precheck] payload', { correlationId, topId, bottomId, neutralPoseId, requireSummariesVersion })
      if (!topId || !neutralPoseId) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', correlationId }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const version = requireSummariesVersion || GARMENT_SUMMARY_VERSION
      const ctx = await requireUser(req)
      const supabase = ctx.adminClient
      // Check neutral pose
      const { data: pose, error: poseErr } = await supabase.from('user_neutral_poses').select('id, storage_path, status').eq('id', neutralPoseId).eq('user_id', userId).single()
      if (poseErr || !pose || pose.status !== 'ready') {
        return new Response(JSON.stringify({ status: 'error', code: 'E_POSE_INVALID', correlationId }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      // Model images
      const topModel = await selectDeterministicModelImage(topId, null)
      const bottomModel = hasBottom ? await selectDeterministicModelImage(bottomId, null) : null
      const missing = [] as string[]
      if (!topModel) missing.push('topModel')
      if (hasBottom && !bottomModel) missing.push('bottomModel')
      if (missing.length > 0) {
        return new Response(JSON.stringify({ status: 'missing_assets', details: missing, correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      // Summaries
      const { data: topProd } = await supabase.from('products').select('id, garment_summary, garment_summary_version').eq('id', topId).single()
      const { data: bottomProd } = hasBottom
        ? await supabase.from('products').select('id, garment_summary, garment_summary_version').eq('id', bottomId).single()
        : { data: null }
      const bottomSummaryInvalid = hasBottom ? (!bottomProd?.garment_summary || bottomProd?.garment_summary_version !== version) : false
      const summariesInvalid = !topProd?.garment_summary || topProd?.garment_summary_version !== version || bottomSummaryInvalid
      if (summariesInvalid) {
        return new Response(JSON.stringify({ status: 'summaries_outdated', correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      console.log('[VTO][Precheck] ok', { correlationId, neutralPosePath: pose.storage_path, topModelUrl: topModel.url, bottomModelUrl: bottomModel?.url || null })
      return new Response(JSON.stringify({
        status: 'ok',
        inputs: {
          neutralPosePath: pose.storage_path,
          topModelUrl: topModel.url,
          bottomModelUrl: bottomModel?.url || null,
        },
        correlationId,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (req.method === 'POST' && pathname.endsWith('/generate')) {
      console.log('[VTO][Generate] start', { correlationId, userId })
      const started = Date.now()
      const { outfitSnapshot, topId, bottomId, neutralPoseId, generationId: incomingId } = await req.json()
      const hasBottom = !!bottomId
      if (!topId || !neutralPoseId) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', correlationId }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      console.log('[VTO][Generate] payload', { correlationId, topId, bottomId, neutralPoseId, hasOutfitSnapshot: !!outfitSnapshot, incomingId })
      const ctx = await requireUser(req)
      const supabase = ctx.adminClient
      // Create private outfit (ensure required NOT NULL columns have values)
      const outfitId = outfitSnapshot?.id || crypto.randomUUID()
      // Try to resolve defaults required by NOT NULL / FK constraints
      let defaultOccasionId: string | null = null
      let defaultCategoryId: string | null = outfitSnapshot?.category || null
      try {
        const { data: occ } = await supabase.from('occasions').select('id').limit(1).single()
        defaultOccasionId = occ?.id || null
      } catch {}
      if (!defaultCategoryId) {
        try {
          // Prefer a category that looks like VTO/Generations if present; else first available
          const { data: catVto } = await supabase.from('categories').select('id').ilike('name', '%vto%').limit(1).single()
          defaultCategoryId = catVto?.id || null
          if (!defaultCategoryId) {
            const { data: catGen } = await supabase.from('categories').select('id').ilike('name', '%generation%').limit(1).single()
            defaultCategoryId = catGen?.id || null
          }
          if (!defaultCategoryId) {
            const { data: catAny } = await supabase.from('categories').select('id').limit(1).single()
            defaultCategoryId = catAny?.id || null
          }
        } catch {}
      }
      const baseOutfit = {
        id: outfitId,
        name: outfitSnapshot?.name || 'VTO Generation',
        category: defaultCategoryId,
        is_private: true as const,
        visible_in_feed: false as const,
        // If your schema requires `occasion` NOT NULL, use the snapshot value or a default
        occasion: outfitSnapshot?.occasion || defaultOccasionId || undefined,
        background_id: outfitSnapshot?.background_id || null,
        top_id: outfitSnapshot?.top_id || null,
        bottom_id: outfitSnapshot?.bottom_id || null,
        shoes_id: outfitSnapshot?.shoes_id || null,
        gender: outfitSnapshot?.gender || null,
      } as any
      const { data: upsertedOutfit, error: outfitErr } = await supabase
        .from('outfits')
        .upsert(baseOutfit)
        .select()
        .single()
      if (outfitErr) {
        console.error('[VTO][Generate] outfit upsert error', { correlationId, err: outfitErr.message })
      } else {
        console.log('[VTO][Generate] outfit ready', { correlationId, outfitId })
      }
      // Upsert generations collection membership
      if (!outfitErr) {
        const { error: favErr } = await supabase
          .from('user_favorites')
          .upsert(
            { user_id: userId, outfit_id: outfitId, collection_slug: 'generations', collection_label: 'Generations' },
            { onConflict: 'user_id,collection_slug,outfit_id' }
          )
        if (favErr) {
          console.error('[VTO][Generate] favorites upsert error', { correlationId, err: favErr.message })
        } else {
          console.log('[VTO][Generate] favorites membership upserted', { correlationId, outfitId })
        }
      }
      // Build try-on prompt
      const { data: topProd } = await supabase.from('products').select('id, garment_summary').eq('id', topId).single()
      const { data: bottomProd } = hasBottom
        ? await supabase.from('products').select('id, garment_summary').eq('id', bottomId).single()
        : { data: null }
      const appendixLines: string[] = []
      function appendSummary(label: string, s: any) {
        if (!s) return
        appendixLines.push(`- ${label.toUpperCase()}:`)
        if (s.raw_summary) {
          appendixLines.push(`  ${s.raw_summary}`)
          return
        }
        const fields = ['fabric','texture','color','pattern','silhouette','length','fit_notes','construction','style_notes']
        for (const f of fields) if (s[f]) appendixLines.push(`  ${f}: ${s[f]}`)
        if (Array.isArray(s.key_features) && s.key_features.length) appendixLines.push(`  key_features: ${s.key_features.join(', ')}`)
      }
      appendSummary('top', topProd?.garment_summary)
      if (hasBottom) appendSummary('bottom', bottomProd?.garment_summary)
      const appendix = appendixLines.join('\n') || 'No extra garment summaries.'
      const promptTemplate = hasBottom ? PROMPT_TRYON_TOPBOTTOM : PROMPT_TRYON_SINGLE
      const prompt = promptTemplate.replace('{GARMENT_SUMMARIES}', appendix)

      // Resolve inputs
      const { data: pose } = await supabase.from('user_neutral_poses').select('storage_path').eq('id', neutralPoseId).single()
      const topModel = await selectDeterministicModelImage(topId, null)
      const bottomModel = hasBottom ? await selectDeterministicModelImage(bottomId, null) : null
      console.log('[VTO][Generate] inputs resolved', { correlationId, neutralPosePath: pose?.storage_path || null, topModelUrl: topModel?.url || null, bottomModelUrl: bottomModel?.url || null })
      const parts: any[] = []
      if (pose?.storage_path) parts.push(await toInlineImagePartFromUrl((await createSignedUrl('neutral-poses', pose.storage_path, 3600))?.signedUrl))
      if (topModel?.url) parts.push(await toInlineImagePartFromUrl(topModel.url))
      if (hasBottom && bottomModel?.url) parts.push(await toInlineImagePartFromUrl(bottomModel.url))
      parts.push({ text: prompt })

      // Idempotent generation record and state transitions
      const generationId = incomingId || crypto.randomUUID()
      try {
        const { data: existing } = await supabase
          .from('user_generations')
          .select('id, status, storage_path')
          .eq('id', generationId)
          .eq('user_id', userId)
          .maybeSingle()
        if (!existing) {
          await supabase.from('user_generations').insert({ id: generationId, user_id: userId, outfit_id: outfitId, neutral_pose_id: neutralPoseId, status: 'queued' })
          console.log('[VTO][Generate] state', { correlationId, generationId, state: 'queued' })
        } else if (existing.status === 'ready' && existing.storage_path) {
          const signed = await createSignedUrl('generations', existing.storage_path, 3600)
          const durationMs = Date.now() - started
          console.log('[VTO][Generate] idempotent ready', { correlationId, generationId })
          return new Response(JSON.stringify({ status: 'ready', generationId, outfitId, storagePath: existing.storage_path, signedUrl: signed?.signedUrl, durationMs, correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
      } catch (e) {
        console.warn('[VTO][Generate] pre-state error', { correlationId, err: (e as Error).message })
      }

      let gen: any
      try {
        await supabase.from('user_generations').update({ status: 'generating' }).eq('id', generationId).eq('user_id', userId)
        console.log('[VTO][Generate] state', { correlationId, generationId, state: 'generating' })
        gen = await generateImage({ modelName: IMG_MODEL, systemInstruction: SYSTEM_INSTRUCTION_TRYON, parts, temperature: 0.1, seed: 7 })
      } catch (e) {
        console.error('[VTO][Generate] model error', { correlationId, err: (e as Error).message })
        await supabase.from('user_generations').update({ status: 'failed', metadata: { error: (e as Error).message } }).eq('id', generationId).eq('user_id', userId)
        return new Response(JSON.stringify({ status: 'error', code: 'E_MODEL', message: (e as Error).message, correlationId }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      console.log('[VTO][Generate] model returned', { correlationId, mime: gen?.mime || 'image/png', bytes: gen?.bytes ? gen.bytes.length : 0 })
      const storagePath = `${userId}/${generationId}.png`
      try {
        await supabase.from('user_generations').update({ status: 'finalizing' }).eq('id', generationId).eq('user_id', userId)
        console.log('[VTO][Generate] state', { correlationId, generationId, state: 'finalizing' })
        await putObject('generations', storagePath, gen.bytes, gen.mime || 'image/png')
      } catch (e) {
        console.error('[VTO][Generate] storage upload error', { correlationId, err: (e as Error).message, storagePath })
        await supabase.from('user_generations').update({ status: 'failed', metadata: { error: (e as Error).message } }).eq('id', generationId).eq('user_id', userId)
        return new Response(JSON.stringify({ status: 'error', code: 'E_UPLOAD', message: (e as Error).message, correlationId }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const { error: upErr } = await supabase.from('user_generations').update({ storage_path: storagePath, status: 'ready' }).eq('id', generationId).eq('user_id', userId)
      if (upErr) {
        console.error('[VTO][Generate] user_generations update error', { correlationId, err: upErr.message })
      }
      const signed = await createSignedUrl('generations', storagePath, 3600)
      const durationMs = Date.now() - started
      console.log('[VTO][Generate] ready', { correlationId, generationId, storagePath, durationMs })
      return new Response(JSON.stringify({ status: 'ready', generationId, outfitId, storagePath, signedUrl: signed?.signedUrl, durationMs, correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Not found', correlationId }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('[VTO] error', { correlationId: (await requireUser(req)).correlationId, error: (error as Error).message })
    return new Response(JSON.stringify({ status: 'error', code: 'E_INTERNAL', message: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
