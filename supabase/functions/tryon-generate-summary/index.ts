// @ts-nocheck
/* eslint-disable */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, requireUser } from '../_shared/auth.ts'
import { getGeminiClient, toInlineImagePartFromUrl } from '../_shared/gemini.ts'
import { getFrontImageCandidates } from '../_shared/modelImages.ts'
import {
  TRYON_STAGE1_MODEL,
  TRYON_STAGE1_TEMPERATURE,
  TRYON_STAGE1_TOP_K,
  GARMENT_SUMMARY_VERSION,
} from '../_shared/versions.ts'
import {
  TRYON_TOPWEAR_STAGE1_SYSTEM,
  TRYON_TOPWEAR_STAGE1_PROMPT,
  TRYON_BOTTOMWEAR_STAGE1_SYSTEM,
  TRYON_BOTTOMWEAR_STAGE1_PROMPT,
  TRYON_FOOTWEAR_STAGE1_SYSTEM,
  TRYON_FOOTWEAR_STAGE1_PROMPT,
  TRYON_DRESS_STAGE1_SYSTEM,
  TRYON_DRESS_STAGE1_PROMPT,
} from '../_shared/prompts.ts'

const CATEGORY_PROMPTS = {
  topwear: {
    system: TRYON_TOPWEAR_STAGE1_SYSTEM,
    prompt: TRYON_TOPWEAR_STAGE1_PROMPT,
  },
  bottomwear: {
    system: TRYON_BOTTOMWEAR_STAGE1_SYSTEM,
    prompt: TRYON_BOTTOMWEAR_STAGE1_PROMPT,
  },
  footwear: {
    system: TRYON_FOOTWEAR_STAGE1_SYSTEM,
    prompt: TRYON_FOOTWEAR_STAGE1_PROMPT,
  },
  dresses: {
    system: TRYON_DRESS_STAGE1_SYSTEM,
    prompt: TRYON_DRESS_STAGE1_PROMPT,
  },
} as const

type Stage1Category = keyof typeof CATEGORY_PROMPTS

function resolveCategory(typeCategory?: string | null, type?: string | null): Stage1Category {
  const normalized = (typeCategory || type || '').toLowerCase()
  if (normalized.includes('dress') || normalized.includes('gown') || normalized.includes('one piece')) {
    return 'dresses'
  }
  if (normalized.includes('shoe') || normalized.includes('footwear') || normalized.includes('sandal') || normalized.includes('heel')) {
    return 'footwear'
  }
  if (normalized.includes('bottom') || normalized.includes('skirt') || normalized.includes('pant') || normalized.includes('jean') || normalized.includes('short')) {
    return 'bottomwear'
  }
  return 'topwear'
}

function parseStage1Response(text: string) {
  const result: {
    tech_pack?: string
    garment_physics?: string
    shoe_physics?: string
    item_name?: string
    color_and_fabric?: string
  } = {}
  const techLines: string[] = []
  const garmentLines: string[] = []
  const shoeLines: string[] = []
  let section: 'tech' | 'garment' | 'shoe' | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const upper = line.toUpperCase()
    if (!line) continue
    if (upper === '[TECH_PACK]') {
      section = 'tech'
      continue
    }
    if (upper === '[GARMENT_PHYSICS]') {
      section = 'garment'
      continue
    }
    if (upper === '[SHOE_PHYSICS]') {
      section = 'shoe'
      continue
    }
    if (line.startsWith('ITEM_NAME:')) {
      result.item_name = line.split(':', 2)[1]?.trim() ?? ''
      section = null
      continue
    }
    if (line.startsWith('COLOR_AND_FABRIC:')) {
      result.color_and_fabric = line.split(':', 2)[1]?.trim() ?? ''
      section = null
      continue
    }
    if (section === 'tech') techLines.push(rawLine)
    if (section === 'garment') garmentLines.push(rawLine)
    if (section === 'shoe') shoeLines.push(rawLine)
  }

  if (techLines.length) {
    const block = techLines.join('\n').trim()
    result.tech_pack = block ? `[TECH_PACK]\n${block}` : undefined
  }
  if (garmentLines.length) {
    const block = garmentLines.join('\n').trim()
    result.garment_physics = block ? `[GARMENT_PHYSICS]\n${block}` : undefined
  }
  if (shoeLines.length) {
    const block = shoeLines.join('\n').trim()
    result.shoe_physics = block ? `[SHOE_PHYSICS]\n${block}` : undefined
  }
  return result
}

async function invokeStage1({
  systemInstruction,
  prompt,
  productUrl,
  imageUrls,
}: {
  systemInstruction: string
  prompt: string
  productUrl: string
  imageUrls: string[]
}) {
  const genai = getGeminiClient()
  const model = genai.getGenerativeModel({
    model: TRYON_STAGE1_MODEL,
    systemInstruction,
  })
  const parts: any[] = []
  for (const url of imageUrls) {
    parts.push(await toInlineImagePartFromUrl(url))
  }
  const promptWithUrl = prompt.replace('{PRODUCT_LINK}', productUrl)
  parts.push({ text: promptWithUrl })
  const response = await model.generateContent({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: TRYON_STAGE1_TEMPERATURE,
      topK: TRYON_STAGE1_TOP_K,
    },
  })
  const text = response?.response?.text?.() ?? ''
  if (!text.trim()) {
    throw new Error('Stage1 summary returned empty text')
  }
  return { text, model: TRYON_STAGE1_MODEL }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Not found', { status: 404, headers: corsHeaders })
  }

  const { correlationId, adminClient } = await requireUser(req)

  try {
    const { productId } = await req.json()
    if (!productId || typeof productId !== 'string') {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', message: 'productId is required', correlationId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: product, error: productError } = await adminClient
      .from('products')
      .select('id, type, type_category, product_url, garment_summary_front, garment_summary_version')
      .eq('id', productId)
      .single()

    if (productError || !product) {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_PRODUCT_NOT_FOUND', correlationId }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Cache check: skip regeneration if summary already exists with current version
    if (product.garment_summary_version === GARMENT_SUMMARY_VERSION && product.garment_summary_front) {
      console.log('[tryon-generate-summary] cache hit', { correlationId, productId, version: GARMENT_SUMMARY_VERSION })
      return new Response(
        JSON.stringify({
          status: 'ok',
          productId,
          version: GARMENT_SUMMARY_VERSION,
          physicsBlock: product.garment_summary_front?.garment_physics ?? product.garment_summary_front?.shoe_physics ?? null,
          correlationId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!product.product_url) {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_PRODUCT_URL_MISSING', correlationId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const category = resolveCategory(product.type_category, product.type)
    const promptConfig = CATEGORY_PROMPTS[category]
    if (!promptConfig) {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_CATEGORY_UNSUPPORTED', correlationId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { model: modelImages, flatlay: flatlayImages } = await getFrontImageCandidates(productId)
    const imageCandidates = [...modelImages, ...flatlayImages]
      .map((row) => row.url)
      .filter((url): url is string => Boolean(url))

    if (!imageCandidates.length) {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_NO_IMAGES', correlationId }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const resolvedParts: string[] = imageCandidates
      .map((url) => {
        if (/^https?:\/\//i.test(url)) return url
        const base = Deno.env.get('PUBLIC_ASSETS_BASE_URL') || ''
        if (!base) return null
        const needsSlash = base.endsWith('/') || url.startsWith('/') ? '' : '/'
        return `${base}${needsSlash}${url}`
      })
      .filter((url): url is string => Boolean(url))

    if (!resolvedParts.length) {
      return new Response(
        JSON.stringify({ status: 'error', code: 'E_IMAGE_RESOLVE', correlationId }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const stage1Response = await invokeStage1({
      systemInstruction: promptConfig.system,
      prompt: promptConfig.prompt,
      productUrl: product.product_url,
      imageUrls: resolvedParts,
    })

    const parsed = parseStage1Response(stage1Response.text)
    const summaryPayload = {
      tech_pack: parsed.tech_pack ?? null,
      garment_physics: parsed.garment_physics ?? null,
      shoe_physics: parsed.shoe_physics ?? null,
      item_name: parsed.item_name ?? null,
      color_and_fabric: parsed.color_and_fabric ?? null,
      raw: stage1Response.text,
      prompt_version: GARMENT_SUMMARY_VERSION,
      updated_at: new Date().toISOString(),
    }

    const { error: updateError } = await adminClient
      .from('products')
      .update({
        garment_summary_front: summaryPayload,
        garment_summary_version: GARMENT_SUMMARY_VERSION,
      })
      .eq('id', productId)

    if (updateError) {
      throw new Error(updateError.message)
    }

    console.log('[tryon-generate-summary] success', {
      correlationId,
      productId,
      category,
      version: GARMENT_SUMMARY_VERSION,
    })

    return new Response(
      JSON.stringify({
        status: 'ok',
        productId,
        version: GARMENT_SUMMARY_VERSION,
        physicsBlock: parsed.garment_physics ?? parsed.shoe_physics ?? null,
        correlationId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('[tryon-generate-summary] error', { error: (error as Error)?.message })
    return new Response(
      JSON.stringify({ status: 'error', code: 'E_INTERNAL', message: (error as Error)?.message ?? 'unknown', correlationId }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

