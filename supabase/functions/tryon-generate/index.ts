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
  if (items.hasTop && items.hasBottom) return 'topbottom'
  if (items.hasFootwear && (items.hasTop || items.hasBottom)) return 'onepiece'
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
  if (data.garment_summary_front && data.garment_summary_version === GARMENT_SUMMARY_VERSION) {
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

async function generateImageFromModel(parts: any[]) {
  const genai = getGeminiClient()
  const model = genai.getGenerativeModel({
    model: TRYON_STAGE2_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION_TRYON,
  })
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
        return { bytes, mimeType }
      }
    }
  }
  throw new Error('E_NO_IMAGE_RETURNED')
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

    const generationPath = `${userId}/${generationId}.png`

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
        },
      })
      .eq('id', generationId)
      .eq('user_id', userId)

    const signed = await createSignedUrl(GENERATIONS_BUCKET, generationPath, 3600)
    console.log('[tryon-generate] ready', {
      correlationId,
      userId,
      generationId,
      outfitId,
      promptTemplate,
    })

    return new Response(
      JSON.stringify({
        status: 'ready',
        generationId,
        outfitId,
        storagePath: generationPath,
        signedUrl: signed?.signedUrl,
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
