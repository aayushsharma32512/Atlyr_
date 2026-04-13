// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

console.log("🚀 Search Outfits V2 Function Up!")

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
            global: { headers: { Authorization: authHeader ?? '' } }
        })

        // Receive filters from Frontend
        const { q, imageUrl, filters } = await req.json()

        if (!q && !imageUrl) {
            return new Response(JSON.stringify({ error: "Provide 'q' (text) or 'imageUrl'" }), { status: 400 })
        }

        let results = []

        // We pass 'filters' to every strategy
        if (q && imageUrl) {
            console.log("⚡ Mode: Hybrid")
            results = await searchHybridOptimized(q, imageUrl, filters, supabase)
        }
        else if (imageUrl) {
            console.log("⚡ Mode: Image Only")
            results = await searchByImage(imageUrl, filters, supabase)
        }
        else {
            console.log("⚡ Mode: Text Only")
            results = await searchByText(q, filters, supabase)
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

async function searchByText(text: string, filters: any, supabase: any) {
    const vector = await getVectorFromModal({ text })
    const [textHits, imageHits] = await Promise.all([
        rpc(supabase, 'match_outfits_text', vector, filters),
        rpc(supabase, 'match_outfits_image', vector, filters)
    ])
    // Logic: Normalize + Weighted Sum
    return fuseAndSort(normalize(textHits), normalize(imageHits), 0.25, 0.75)
}

async function searchByImage(imageUrl: string, filters: any, supabase: any) {
    const image_b64 = await urlToBase64(imageUrl)
    const vector = await getVectorFromModal({ image_b64 })
    const [textHits, imageHits] = await Promise.all([
        rpc(supabase, 'match_outfits_text', vector, filters),
        rpc(supabase, 'match_outfits_image', vector, filters)
    ])
    // Logic: Normalize + Weighted Sum
    return fuseAndSort(normalize(textHits), normalize(imageHits), 0, 1)
}

async function searchHybridOptimized(text: string, imageUrl: string, filters: any, supabase: any) {
    const image_b64 = await urlToBase64(imageUrl)
    const [textVector, imageVector] = await Promise.all([
        getVectorFromModal({ text }),
        getVectorFromModal({ image_b64 })
    ])

    const [
        textToText,
        textToImage,
        imageToText,
        imageToImage
    ] = await Promise.all([
        rpc(supabase, 'match_outfits_text', textVector, filters),
        rpc(supabase, 'match_outfits_image', textVector, filters),
        rpc(supabase, 'match_outfits_text', imageVector, filters),
        rpc(supabase, 'match_outfits_image', imageVector, filters)
    ])

    // Fuse using weights (0.65/0.35)
    const textSearchResults = fuseAndSort(normalize(textToText), normalize(textToImage), 0.75, 0.25)
    const imageSearchResults = fuseAndSort(normalize(imageToText), normalize(imageToImage), 0.25, 0.75)

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
        .map((item: any) => ({
            ...item,
            final_score: (item.text_final_score + item.image_final_score) / 2,
        }))
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
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (!resp.ok) throw new Error('Failed to download image')
        const blob = await resp.blob()
        const buffer = await blob.arrayBuffer()
        return base64Encode(new Uint8Array(buffer))
    } catch (e) {
        throw new Error(`Image Download Error: ${e.message}`)
    }
}

// Updated RPC to pass filters
async function rpc(client: any, func: string, vector: number[], filters?: any) {
    const { data, error } = await client.rpc(func, {
        query_embedding: vector,
        filters: filters || {},
        match_threshold: 0,
        match_count: 50 // Standard fetch count, can be increased if needed
    })
    if (error) throw error
    return data
}

// OLD LOGIC: Normalization
function normalize(items: any[]) {
    if (!items.length) return []
    const scores = items.map(i => i.similarity)
    const min = Math.min(...scores); const max = Math.max(...scores); const range = max - min
    return items.map(i => ({ ...i, norm_score: range === 0 ? 1 : (i.similarity - min) / range }))
}

// OLD LOGIC: Weighted Fusion
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
