// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

console.log("🚀 Search V2 (Filtered) Function Up!")

const MODAL_URL = Deno.env.get('MODAL_API_URL')!
const MODAL_TOKEN = Deno.env.get('MODAL_AUTH_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
    }

    const authHeader = req.headers.get('Authorization')
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: authHeader??'' } }
    })

    const { q, imageUrl, productId, filters, weights } = await req.json()

    if (!q && !imageUrl && !productId) {
      return new Response(JSON.stringify({ error: "Provide 'q' (text), 'imageUrl', or 'productId'" }), { status: 400 })
    }

    let results = []

    if (productId && q) {
      console.log("⚡ Mode: Hybrid (stored vector)")
      results = await searchHybridWithProductId(q, productId, imageUrl, filters, supabase)
    }
    else if (productId) {
      console.log("⚡ Mode: Image (stored vector)")
      results = await searchByProductId(productId, imageUrl, filters, supabase)
    }
    else if (q && imageUrl) {
      console.log("⚡ Mode: Hybrid")
      results = await searchHybridOptimized(q, imageUrl, filters, supabase)
    }
    else if (imageUrl) {
      console.log("⚡ Mode: Image Only")
      results = await searchByImage(imageUrl, filters, supabase)
    }
    else {
      console.log("⚡ Mode: Text Only")
      results = await searchByText(q, filters, supabase, weights)
    }

    return new Response(JSON.stringify({ results }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    })

  } catch (err) {
    console.error("❌ Error:", err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  }
})

// --- ⚡ STRATEGIES ---

async function searchByText(text: string, filters: any, supabase: any, weights?: any) {
  const textW = weights?.text ?? 0
  const imageW = weights?.image ?? 1

  const vector = await getVectorFromModal({ text })

  const [
      // textHits,
      imageHits] = await Promise.all([
    // rpc(supabase, 'match_products_text', vector, filters),
    rpc(supabase, 'match_products_image', vector, filters)
  ])
  return fuseAndSort([], normalize(imageHits), textW, imageW)
}

async function searchByImage(imageUrl: string, filters: any, supabase: any) {
  const image_b64 = await urlToBase64(imageUrl)
  const vector = await getVectorFromModal({ image_b64 })

  const [textHits, imageHits] = await Promise.all([
    rpc(supabase, 'match_products_text', vector, filters),
    rpc(supabase, 'match_products_image', vector, filters)
  ])

  return fuseAndSort(normalize(textHits), normalize(imageHits), 0, 1)
}

async function searchHybridOptimized(text: string, imageUrl: string, filters: any, supabase: any) {
  const image_b64 = await urlToBase64(imageUrl)

  const [textVector, imageVector] = await Promise.all([
    getVectorFromModal({ text }),
    getVectorFromModal({ image_b64 })
  ])

  const [textToText, textToImage, imageToText, imageToImage] = await Promise.all([
    rpc(supabase, 'match_products_text', textVector, filters),
    rpc(supabase, 'match_products_image', textVector, filters),
    rpc(supabase, 'match_products_text', imageVector, filters),
    rpc(supabase, 'match_products_image', imageVector, filters)
  ])

  const textSearchResults = fuseAndSort(normalize(textToText), normalize(textToImage), 0.65, 0.35)
  const imageSearchResults = fuseAndSort(normalize(imageToText), normalize(imageToImage), 0.35, 0.65)

  const hybridMap = new Map()
  textSearchResults.forEach((item: any) => {
    hybridMap.set(item.id, { ...item, text_final_score: item.final_score, image_final_score: 0 })
  })
  imageSearchResults.forEach((item: any) => {
    if (hybridMap.has(item.id)) {
      hybridMap.get(item.id).image_final_score = item.final_score
    } else {
      hybridMap.set(item.id, { ...item, text_final_score: 0, image_final_score: item.final_score })
    }
  })

  return Array.from(hybridMap.values())
    .map((item: any) => ({ ...item, final_score: (item.text_final_score + item.image_final_score) / 2 }))
    .sort((a: any, b: any) => b.final_score - a.final_score)
}

async function searchByProductId(productId: string, imageUrl: string | null, filters: any, supabase: any) {
  const { data } = await supabase.from('products').select('image_vector').eq('id', productId).single()
  const vector = data?.image_vector ?? null

  if (!vector) {
    console.log("⚠️ No stored vector, falling back to Modal")
    if (!imageUrl) throw new Error('No stored vector and no imageUrl fallback')
    return searchByImage(imageUrl, filters, supabase)
  }

  const [
      // textHits,
    imageHits] = await Promise.all([
    // rpc(supabase, 'match_products_text', vector, filters),
    rpc(supabase, 'match_products_image', vector, filters)
  ])

  return fuseAndSort([], normalize(imageHits), 0, 1)
}

async function searchHybridWithProductId(text: string, productId: string, imageUrl: string | null, filters: any, supabase: any) {
  const [{ data }, textVector] = await Promise.all([
    supabase.from('products').select('image_vector').eq('id', productId).single(),
    getVectorFromModal({ text })
  ])
  const imageVector = data?.image_vector ?? null

  if (!imageVector) {
    console.log("⚠️ No stored vector, falling back to full hybrid")
    if (!imageUrl) return searchByText(text, filters, supabase)
    return searchHybridOptimized(text, imageUrl, filters, supabase)
  }

  const [
      // textToText,
      textToImage,
      // imageToText,
      imageToImage] = await Promise.all([
    // rpc(supabase, 'match_products_text', textVector, filters),
    rpc(supabase, 'match_products_image', textVector, filters),
    // rpc(supabase, 'match_products_text', imageVector, filters),
    rpc(supabase, 'match_products_image', imageVector, filters)
  ])

  const textSearchResults = fuseAndSort([], normalize(textToImage), 0, 1)
  const imageSearchResults = fuseAndSort([], normalize(imageToImage), 0, 1)

  const hybridMap = new Map()
  textSearchResults.forEach((item: any) => {
    hybridMap.set(item.id, { ...item, text_final_score: item.final_score, image_final_score: 0 })
  })
  imageSearchResults.forEach((item: any) => {
    if (hybridMap.has(item.id)) {
      hybridMap.get(item.id).image_final_score = item.final_score
    } else {
      hybridMap.set(item.id, { ...item, text_final_score: 0, image_final_score: item.final_score })
    }
  })

  return Array.from(hybridMap.values())
    .map((item: any) => ({ ...item, final_score: (item.text_final_score + item.image_final_score) / 2 }))
    .sort((a: any, b: any) => b.final_score - a.final_score)
}

// --- HELPERS ---

async function getVectorFromModal(payload: any) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120000)

  try {
    const resp = await fetch(MODAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Modal-Token': MODAL_TOKEN },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    if (!resp.ok) throw new Error(`Modal API Error: ${await resp.text()}`)
    const data = await resp.json()
    return data.vector || data.embedding || data
  } catch (error) {
    if (error.name === 'AbortError') throw new Error("Modal Timeout (GPU Cold Start)")
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function urlToBase64(url: string) {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mclozilla/5.0' } })
    if (!resp.ok) throw new Error('Failed to download image')
    const blob = await resp.blob()
    const buffer = await blob.arrayBuffer()
    return base64Encode(new Uint8Array(buffer))
  } catch (e) {
    throw new Error(`Image Download Error: ${e.message}`)
  }
}

async function rpc(client: any, func: string, vector: number[], filters?: any) {
  const { data, error } = await client.rpc(func, {
    query_embedding: vector,
    filters: filters || {},
    match_threshold: -1,
    match_count: 50 // Standard fetch count, can be increased if needed
  })
  if (error) throw error
  return data
}

function normalize(items: any[]) {
  if (!items.length) return []
  const scores = items.map(i => i.similarity)
  const min = Math.min(...scores); const max = Math.max(...scores); const range = max - min
  return items.map(i => ({ ...i, norm_score: range === 0 ? 1 : (i.similarity - min) / range }))
}

function fuseAndSort(textHits: any[], imageHits: any[], textW: number, imageW: number) {
  const merged = new Map()
  textHits.forEach(i => merged.set(i.id, { ...i, final_score: i.norm_score * textW }))

  imageHits.forEach(i => {
    const existing = merged.get(i.id)
    if (existing) {
      existing.final_score += (i.norm_score * imageW)
    } else {
      merged.set(i.id, { ...i, final_score: i.norm_score * imageW })
    }
  })

  return Array.from(merged.values())
    .sort((a: any, b: any) => b.final_score - a.final_score)
}
