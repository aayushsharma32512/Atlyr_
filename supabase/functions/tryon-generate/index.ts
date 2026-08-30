// @ts-nocheck
/* eslint-disable */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, requireUser } from '../_shared/auth.ts'
import { createSignedUrl, putObject } from '../_shared/storage.ts'
import { getGeminiClient, toInlineImagePartFromUrl } from '../_shared/gemini.ts'
import { selectFrontEligibleImage } from '../_shared/modelImages.ts'
import {
  GARMENT_SUMMARY_VERSION,
  TRYON_STAGE2_MODEL,
  TRYON_STAGE2_TEMPERATURE,
  TRYON_STAGE2_TOP_K,
  TRYON_STAGE2_ASPECT_RATIO,
  TRYON_STAGE2_IMAGE_SIZE,
} from '../_shared/versions.ts'
import {
  SYSTEM_INSTRUCTION_TRYON,
  PROMPT_TRYON_TOPBOTTOM,
  PROMPT_TRYON_ONEPIECE,
  PROMPT_TRYON_SINGLE,
} from '../_shared/prompts.ts'

const NEUTRAL_POSES_BUCKET = 'neutral-poses'
const GENERATIONS_BUCKET = 'generations'
const FUNCTIONS_BASE = `${Deno.env.get('SUPABASE_URL')}/functions/v1`
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

/**
 * Get start of current day in IST (12 AM IST = UTC+5:30).
 * Returns ISO string for Supabase query.
 */
function getStartOfDayIST(): string {
  const now = new Date()
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  // Get start of day in IST
  const istMidnight = new Date(istNow)
  istMidnight.setUTCHours(0, 0, 0, 0)
  // Convert back to UTC
  const utcMidnight = new Date(istMidnight.getTime() - istOffset)
  return utcMidnight.toISOString()
}

type OutfitItems = {
  topId?: string | null
  bottomId?: string | null
  footwearId?: string | null
}

type TryOnRequest = {
  neutralPoseId: string
  outfitItems: OutfitItems
  outfitSnapshot?: Record<string, unknown> | null
  generationId?: string | null
}

const PROMPT_MAP = {
  topbottom: PROMPT_TRYON_TOPBOTTOM,
  onepiece: PROMPT_TRYON_ONEPIECE,
  single: PROMPT_TRYON_SINGLE,
} as const

async function callGenerateSummary(productId: string) {
  if (!SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase service role key')
  }
  const response = await fetch(`${FUNCTIONS_BASE}/tryon-generate-summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ productId }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`[tryon-generate] summary regenerate failed ${response.status}: ${text}`)
  }
}

function extractPhysics(summary: Record<string, unknown> | null | undefined) {
  if (!summary || typeof summary !== 'object') return null
  const candidate =
    (typeof summary.garment_physics === 'string' && summary.garment_physics) ||
    (typeof summary.shoe_physics === 'string' && summary.shoe_physics) ||
    (typeof summary.tech_pack === 'string' && summary.tech_pack) ||
    (typeof summary.raw === 'string' && summary.raw)
  return candidate || null
}

function buildSummariesBlock(segments: Array<{ label: string; summary: string | null }>) {
  const filtered = segments
    .filter((segment) => Boolean(segment.summary))
    .map((segment) => `${segment.label}:\n${segment.summary}`)
  return filtered.join('\n\n')
}

function choosePromptTemplate(items: { hasTop: boolean; hasBottom: boolean; hasFootwear: boolean }) {
  // Footwear never changes the template: it rides along as an extra summary + reference
  // image that the prompts instruct on. (The old mapping sent top+shoes to the ONE-PIECE
  // prompt, which describes a dress.)
  if (items.hasTop && items.hasBottom) return 'topbottom'
  if (items.hasTop || items.hasBottom || items.hasFootwear) return 'single'
  throw new Error('E_NO_OUTFIT_ITEMS')
}

async function ensureSummary(adminClient: any, productId: string) {
  const { data, error } = await adminClient
    .from('products')
    .select('garment_summary_front, garment_summary_version')
    .eq('id', productId)
    .single()
  if (error || !data) {
    throw new Error(`[tryon-generate] product ${productId} not found`)
  }
  // Accept any existing summary with usable physics, whatever version wrote it. The
  // ingestion service writes richer v1.1 summaries (with shoe_physics); gating on this
  // function's own version made every try-on overwrite those with v1.0.0 regenerations.
  if (data.garment_summary_front && extractPhysics(data.garment_summary_front)) {
    return data.garment_summary_front as Record<string, unknown>
  }
  await callGenerateSummary(productId)
  const { data: refreshed, error: refreshedError } = await adminClient
    .from('products')
    .select('garment_summary_front')
    .eq('id', productId)
    .single()
  if (refreshedError || !refreshed?.garment_summary_front) {
    throw new Error(`[tryon-generate] unable to refresh summary for ${productId}`)
  }
  return refreshed.garment_summary_front as Record<string, unknown>
}

async function fetchNeutralPose(adminClient: any, userId: string, neutralPoseId: string) {
  const { data, error } = await adminClient
    .from('user_neutral_poses')
    .select('id, storage_path, status')
    .eq('id', neutralPoseId)
    .eq('user_id', userId)
    .single()
  if (error || !data) {
    throw new Error('E_POSE_NOT_FOUND')
  }
  if (data.status !== 'ready' || !data.storage_path) {
    throw new Error('E_POSE_NOT_READY')
  }
  const signed = await createSignedUrl(NEUTRAL_POSES_BUCKET, data.storage_path, 3600)
  return { path: data.storage_path, signedUrl: signed?.signedUrl }
}

async function fetchProductRows(adminClient: any, ids: string[]) {
  if (!ids.length) return []
  const { data, error } = await adminClient
    .from('products')
    .select('id, type, type_category, garment_summary_front, garment_summary_version')
    .in('id', ids)
  if (error) throw new Error(`[tryon-generate] products fetch failed: ${error.message}`)
  return data ?? []
}

async function callImageModelOnce(modelName: string, parts: any[], timeoutMs: number) {
  const genai = getGeminiClient()
  const model = genai.getGenerativeModel(
    {
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION_TRYON,
    },
    { timeout: timeoutMs },
  )
  const response: any = await model.generateContent({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: TRYON_STAGE2_TEMPERATURE,
      topK: TRYON_STAGE2_TOP_K,
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: TRYON_STAGE2_ASPECT_RATIO,
        imageSize: TRYON_STAGE2_IMAGE_SIZE,
      },
    },
  })
  const candidates = response?.response?.candidates || []
  for (const cand of candidates) {
    const partsResp = cand?.content?.parts || []
    for (const part of partsResp) {
      if (part?.inlineData?.data) {
        const bytes = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0))
        const mimeType = part.inlineData.mimeType || 'image/png'
        return { bytes, mimeType, modelUsed: modelName }
      }
    }
  }
  const finishReason = candidates[0]?.finishReason ?? 'no_candidates'
  throw new Error(`E_NO_IMAGE_RETURNED (finishReason=${finishReason})`)
}

// Simple two-step ladder (AI Studio only; Vertex deliberately not wired up yet):
// one honest shot at the pro model, then the flash fallback guarantees an answer.
// gemini-3-pro-image intermittently HANGS rather than erroring (measured 280s+ with no
// response on requests that other times finish in 20s), so each attempt carries its own
// timeout. Pro's cap must clear the measured 104-155s healthy range — a lower cap kills
// generations that were on track to succeed (see the ingestion transport's comment).
// Flash matches GEMINI_IMAGE_MODEL_FALLBACKS in services/ingestion-automated.
const IMAGE_ATTEMPTS: Array<{ model: string; timeoutMs: number }> = [
  { model: TRYON_STAGE2_MODEL, timeoutMs: 150_000 },
  { model: 'gemini-3.1-flash-image', timeoutMs: 90_000 },
]

async function generateImageFromModel(parts: any[]) {
  let lastError: Error | null = null
  for (const [index, attempt] of IMAGE_ATTEMPTS.entries()) {
    try {
      const result = await callImageModelOnce(attempt.model, parts, attempt.timeoutMs)
      console.log('[tryon-generate] image attempt succeeded', { attempt: index + 1, model: attempt.model })
      return { ...result, attempt: index + 1 }
    } catch (error) {
      lastError = error as Error
      console.warn('[tryon-generate] image attempt failed', {
        attempt: index + 1,
        model: attempt.model,
        message: lastError?.message ?? 'unknown',
      })
    }
  }
  throw lastError ?? new Error('E_NO_IMAGE_RETURNED')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Not found', { status: 404, headers: corsHeaders })
  }

  const { correlationId, userId, adminClient } = await requireUser(req)
  let pendingGenerationId: string | null = null

  try {
    const body = (await req.json()) as TryOnRequest
    if (!body?.neutralPoseId || typeof body.neutralPoseId !== 'string') {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', message: 'neutralPoseId required', correlationId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    if (!body?.outfitItems || typeof body.outfitItems !== 'object') {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', message: 'outfitItems required', correlationId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const outfitItems = body.outfitItems
    const hasTop = Boolean(outfitItems.topId)
    const hasBottom = Boolean(outfitItems.bottomId)
    const hasFootwear = Boolean(outfitItems.footwearId)
    if (!hasTop && !hasBottom && !hasFootwear) {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_NO_ITEMS', correlationId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Atomic limit check + slot reservation using Postgres function
    // This prevents race conditions - the check and insert are one atomic operation
    // SECURITY: Always generate IDs server-side, never trust client input
    const generationId = crypto.randomUUID()
    pendingGenerationId = generationId
    const outfitId = body?.outfitSnapshot?.id || crypto.randomUUID()

    const { data: reserveResult, error: reserveError } = await adminClient.rpc('reserve_tryon_slot', {
      p_generation_id: generationId,
      p_user_id: userId,
      p_outfit_id: outfitId,
      p_neutral_pose_id: body.neutralPoseId,
      p_daily_limit: 10,
    })

    if (reserveError) {
      console.error('[tryon-generate] reserve_tryon_slot error', { correlationId, message: reserveError.message })
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_SLOT_RESERVE_FAILED', correlationId }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // If reserveResult is null, the limit was reached (atomic check failed)
    if (!reserveResult) {
      console.warn('[tryon-generate] limit reached (atomic)', { correlationId, userId })
      return new Response(
        JSON.stringify({
          status: 'error',
          code: 'E_LIMIT_REACHED',
          message: 'You have reached the daily limit of 10 try-on generations.',
          correlationId,
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const neutralPose = await fetchNeutralPose(adminClient, userId, body.neutralPoseId)

    const productIds = [outfitItems.topId, outfitItems.bottomId, outfitItems.footwearId].filter(
      (id): id is string => Boolean(id),
    )
    const productRows = await fetchProductRows(adminClient, productIds)
    const productMap = new Map<string, any>()
    productRows.forEach((row) => {
      productMap.set(row.id, row)
    })

    const summaries: Record<'top' | 'bottom' | 'footwear', string | null> = {
      top: null,
      bottom: null,
      footwear: null,
    }
    const summaryKeyMap: Record<keyof OutfitItems, keyof typeof summaries> = {
      topId: 'top',
      bottomId: 'bottom',
      footwearId: 'footwear',
    }

    for (const [slot, productId] of Object.entries(outfitItems) as Array<[keyof OutfitItems, string | null | undefined]>) {
      if (!productId) continue
      const productRow = productMap.get(productId)
      if (!productRow) {
        throw new Error(`[tryon-generate] product ${productId} missing`)
      }
      const summary = await ensureSummary(adminClient, productId)
      const physics = extractPhysics(summary)
      summaries[summaryKeyMap[slot]] = physics
    }

    const promptTemplate = choosePromptTemplate({ hasTop, hasBottom, hasFootwear })
    const garmentSummariesBlock = buildSummariesBlock([
      { label: 'Top Summary', summary: summaries.top },
      { label: 'Bottom Summary', summary: summaries.bottom },
      { label: 'Footwear Summary', summary: summaries.footwear },
    ])
    if (!garmentSummariesBlock.trim()) {
      throw new Error('E_MISSING_SUMMARIES')
    }

    const promptText = PROMPT_MAP[promptTemplate].replace('{GARMENT_SUMMARIES}', garmentSummariesBlock)

    const neutralPosePart = await toInlineImagePartFromUrl(neutralPose.signedUrl)
    const garmentImageParts: any[] = []

    if (outfitItems.topId) {
      const ref = await selectFrontEligibleImage(outfitItems.topId)
      garmentImageParts.push(await toInlineImagePartFromUrl(ref.url))
    }
    if (outfitItems.bottomId) {
      const ref = await selectFrontEligibleImage(outfitItems.bottomId)
      garmentImageParts.push(await toInlineImagePartFromUrl(ref.url))
    }
    if (outfitItems.footwearId) {
      const ref = await selectFrontEligibleImage(outfitItems.footwearId)
      garmentImageParts.push(await toInlineImagePartFromUrl(ref.url))
    }
    if (!garmentImageParts.length) {
      throw new Error('E_NO_REFERENCE_IMAGES')
    }

    const contentParts = [neutralPosePart, ...garmentImageParts, { text: promptText }]

    // Update status to generating BEFORE calling the AI model
    await adminClient.from('user_generations').update({ status: 'generating' }).eq('id', generationId).eq('user_id', userId)

    const generationPath = `${userId}/${generationId}.png`

    // Everything from the model call onward runs as a background task (see below): the platform's
    // 150s request idle timeout was killing slow 2K generations mid-call, surfacing to users as
    // "Request idle timeout limit (150s) reached". Background tasks get the full wall clock
    // (~400s). The client learns the outcome by polling user_generations, which it already does.
    const finishGeneration = async () => {
      try {
        const imageResponse = await generateImageFromModel(contentParts)

        const resolvedCategory =
      typeof body?.outfitSnapshot?.category === 'string' && body.outfitSnapshot.category.trim()
        ? body.outfitSnapshot.category
        : 'others'
    const resolvedOccasion =
      typeof body?.outfitSnapshot?.occasion === 'string' && body.outfitSnapshot.occasion.trim()
        ? body.outfitSnapshot.occasion
        : 'others'
    let shouldInsertOutfit = true
    if (body?.outfitSnapshot?.id) {
      try {
        const { data, error } = await adminClient.from('outfits').select('id').eq('id', outfitId).maybeSingle()
        if (error) {
          console.error('[tryon-generate] outfit lookup failed', { message: error.message })
        } else if (data?.id) {
          shouldInsertOutfit = false
        }
      } catch (outfitError) {
        console.error('[tryon-generate] outfit lookup failed', {
          message: (outfitError as Error)?.message ?? 'unknown',
        })
      }
    }

    if (shouldInsertOutfit) {
      const baseOutfit = {
        id: outfitId,
        name: body?.outfitSnapshot?.name || 'VTO Generation',
        category: resolvedCategory,
        is_private: true as const,
        visible_in_feed: false as const,
        occasion: resolvedOccasion,
        background_id: body?.outfitSnapshot?.background_id || null,
        top_id: outfitItems.topId || null,
        bottom_id: outfitItems.bottomId || null,
        shoes_id: outfitItems.footwearId || null,
        gender: body?.outfitSnapshot?.gender || null,
        user_id: userId,
      } as any

      try {
        const { error: outfitError } = await adminClient.from('outfits').insert(baseOutfit).select().single()
        if (outfitError) {
          console.error('[tryon-generate] outfit insert failed', { message: outfitError.message })
        }
      } catch (outfitError) {
        console.error('[tryon-generate] outfit insert failed', {
          message: (outfitError as Error)?.message ?? 'unknown',
        })
      }
    }

    try {
      const { error: favoriteError } = await adminClient
        .from('user_favorites')
        .upsert(
          { user_id: userId, outfit_id: outfitId, collection_slug: 'try-ons', collection_label: 'Try-ons' },
          { onConflict: 'user_id,collection_slug,outfit_id' },
        )
      if (favoriteError) {
        console.error('[tryon-generate] try-ons favorite upsert failed', { message: favoriteError.message })
      }
    } catch (favoriteError) {
      console.error('[tryon-generate] try-ons favorite upsert failed', {
        message: (favoriteError as Error)?.message ?? 'unknown',
      })
    }

    await putObject(GENERATIONS_BUCKET, generationPath, imageResponse.bytes, imageResponse.mimeType)

    await adminClient
      .from('user_generations')
      .update({
        storage_path: generationPath,
        status: 'ready',
        metadata: {
          promptTemplate,
          summaryVersion: GARMENT_SUMMARY_VERSION,
          items: outfitItems,
          imageModel: imageResponse.modelUsed,
          imageAttempt: imageResponse.attempt,
        },
      })
      .eq('id', generationId)
      .eq('user_id', userId)

    console.log('[tryon-generate] ready', {
      correlationId,
      userId,
      generationId,
      outfitId,
      promptTemplate,
    })
      } catch (error) {
        console.error('[tryon-generate] background generation failed', {
          correlationId,
          generationId,
          message: (error as Error)?.message ?? 'unknown',
        })
        try {
          await adminClient
            .from('user_generations')
            .update({
              status: 'failed',
              metadata: { error: (error as Error)?.message ?? 'unknown' },
            })
            .eq('id', generationId)
            .eq('user_id', userId)
        } catch (updateError) {
          console.error('[tryon-generate] failed to mark generation failed', {
            message: (updateError as Error)?.message ?? 'unknown',
          })
        }
      }
    }

    // deno-lint-ignore no-explicit-any
    const runtime = globalThis as any
    if (typeof runtime.EdgeRuntime !== 'undefined' && typeof runtime.EdgeRuntime.waitUntil === 'function') {
      runtime.EdgeRuntime.waitUntil(finishGeneration())
    } else {
      // Local `functions serve` has no waitUntil — run detached and hope the process outlives it.
      finishGeneration()
    }

    console.log('[tryon-generate] accepted, generating in background', { correlationId, userId, generationId, outfitId })
    return new Response(
      JSON.stringify({
        status: 'generating',
        generationId,
        outfitId,
        storagePath: generationPath,
        signedUrl: null,
        correlationId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    if (pendingGenerationId) {
      try {
        const { error: updateError } = await adminClient
          .from('user_generations')
          .update({
            status: 'failed',
            metadata: {
              error: (error as Error)?.message ?? 'unknown',
            },
          })
          .eq('id', pendingGenerationId)
          .eq('user_id', userId)
        if (updateError) {
          console.error('[tryon-generate] failed to mark generation failed', {
            message: updateError.message,
          })
        }
      } catch (updateError) {
        console.error('[tryon-generate] failed to mark generation failed', {
          message: (updateError as Error)?.message ?? 'unknown',
        })
      }
    }
    console.error('[tryon-generate] error', { message: (error as Error)?.message })
    return new Response(
      JSON.stringify({ status: 'error', code: (error as Error)?.message ?? 'E_INTERNAL', correlationId }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
