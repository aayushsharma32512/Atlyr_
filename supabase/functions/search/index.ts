// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { OpenAI } from "https://esm.sh/openai@4"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type SearchType = "outfits" | "products"

interface SearchRequestBody {
  query: string
  searchType?: SearchType
  gender?: "male" | "female"
  limit?: number
  cursor?: number | null
  threshold?: number
  filters?: Record<string, unknown> | null
}

interface VectorCandidate {
  [key: string]: unknown
}

function parseNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function applyOutfitFilters(
  rows: VectorCandidate[],
  gender?: "male" | "female",
  filters?: Record<string, unknown> | null,
) {
  let interim = rows.filter((row) => row?.["visible_in_feed"] === true)

  const forcedGender = typeof gender === "string" ? gender : undefined
  const filterGender = Array.isArray(filters?.genders) ? (filters!.genders as string[]) : undefined

  interim = interim.filter((row) => {
    const rowGender = row?.["gender"]
    if (!rowGender || typeof rowGender !== "string") {
      return false
    }
    if (filterGender && filterGender.length > 0) {
      return filterGender.includes(rowGender)
    }
    if (forcedGender) {
      return rowGender === forcedGender || rowGender === "unisex"
    }
    return rowGender === "unisex"
  })

  if (filters) {
    const categories = Array.isArray(filters.categories) ? (filters.categories as string[]) : null
    if (categories && categories.length > 0) {
      interim = interim.filter((row) => categories.includes(String(row["category"])))
    }

    const occasions = Array.isArray(filters.occasions) ? (filters.occasions as string[]) : null
    if (occasions && occasions.length > 0) {
      interim = interim.filter((row) => occasions.includes(String(row["occasion"])))
    }

    const fits = Array.isArray(filters.fits) ? (filters.fits as string[]) : null
    if (fits && fits.length > 0) {
      interim = interim.filter((row) => row["fit"] && fits.includes(String(row["fit"])))
    }
  }

  return interim
}

function applyProductFilters(
  rows: VectorCandidate[],
  gender?: "male" | "female",
  filters?: Record<string, unknown> | null,
) {
  let interim = [...rows]

  const filterGender = Array.isArray(filters?.genders) ? (filters!.genders as string[]) : null
  if (filterGender && filterGender.length > 0) {
    interim = interim.filter((row) => row["gender"] && filterGender.includes(String(row["gender"])))
  } else if (gender) {
    interim = interim.filter((row) => {
      const rowGender = row["gender"]
      if (!rowGender || typeof rowGender !== "string") {
        return false
      }
      return rowGender === gender || rowGender === "unisex"
    })
  }

  if (filters) {
    const typeCategories = Array.isArray(filters.typeCategories) ? (filters.typeCategories as string[]) : null
    if (typeCategories && typeCategories.length > 0) {
      interim = interim.filter((row) => {
        const value = row["type_category"] ?? row["type"]
        return value && typeCategories.includes(String(value))
      })
    }

    const brands = Array.isArray(filters.brands) ? (filters.brands as string[]) : null
    if (brands && brands.length > 0) {
      interim = interim.filter((row) => row["brand"] && brands.includes(String(row["brand"])))
    }

    const fits = Array.isArray(filters.fits) ? (filters.fits as string[]) : null
    if (fits && fits.length > 0) {
      interim = interim.filter((row) => row["fit"] && fits.includes(String(row["fit"])))
    }

    const feels = Array.isArray(filters.feels) ? (filters.feels as string[]) : null
    if (feels && feels.length > 0) {
      interim = interim.filter((row) => row["feel"] && feels.includes(String(row["feel"])))
    }

    const colorGroups = Array.isArray(filters.colorGroups) ? (filters.colorGroups as string[]) : null
    if (colorGroups && colorGroups.length > 0) {
      interim = interim.filter((row) => row["color_group"] && colorGroups.includes(String(row["color_group"])))
    }

    const sizes = Array.isArray(filters.sizes) ? (filters.sizes as string[]) : null
    if (sizes && sizes.length > 0) {
      interim = interim.filter((row) => row["size"] && sizes.includes(String(row["size"])))
    }

    const minPrice = typeof filters.minPrice === "number" ? (filters.minPrice as number) : null
    const maxPrice = typeof filters.maxPrice === "number" ? (filters.maxPrice as number) : null
    if (typeof minPrice === "number") {
      interim = interim.filter((row) => typeof row["price"] === "number" && (row["price"] as number) >= minPrice)
    }
    if (typeof maxPrice === "number") {
      interim = interim.filter((row) => typeof row["price"] === "number" && (row["price"] as number) <= maxPrice)
    }
  }

  return interim
}

function buildResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { query, searchType = "outfits", gender, limit = 20, cursor = 0, threshold = 0.05, filters }: SearchRequestBody =
      await req.json()

    if (!query || typeof query !== "string") {
      return buildResponse({ error: "Query must be provided" }, { status: 400 })
    }

    if (searchType !== "outfits" && searchType !== "products") {
      return buildResponse({ error: "searchType must be 'outfits' or 'products'" }, { status: 400 })
    }

    const sanitizedLimit = Math.max(1, Math.min(50, parseNumber(limit, 20)))
    const cursorOffset = Math.max(0, parseNumber(cursor, 0))

    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") })
    const { data: embeddingData } = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
      encoding_format: "float",
    })
    const embedding = embeddingData[0].embedding

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    const matchCount = Math.max((cursorOffset + 1) * sanitizedLimit * 2, sanitizedLimit * 4)

    let rpcName = ""
    if (searchType === "outfits") {
      rpcName = "search_outfits_by_vector"
    } else {
      rpcName = "search_products_by_vector"
    }

    const { data, error } = await supabase.rpc(rpcName, {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: matchCount,
    })

    if (error) {
      console.error("Vector RPC error", error)
      return buildResponse({ error: "Vector search failed" }, { status: 500 })
    }

    const rows = Array.isArray(data) ? (data as VectorCandidate[]) : []
    const filtered =
      searchType === "outfits"
        ? applyOutfitFilters(rows, gender, filters ?? null)
        : applyProductFilters(rows, gender, filters ?? null)

    const paginated = filtered.slice(cursorOffset, cursorOffset + sanitizedLimit)
    const nextCursor = cursorOffset + sanitizedLimit < filtered.length ? cursorOffset + sanitizedLimit : null

    return buildResponse({
      results: paginated,
      nextCursor,
      count: paginated.length,
    })
  } catch (error) {
    console.error("Search function error", error)
    return buildResponse({ error: "Internal server error", details: error?.message ?? String(error) }, { status: 500 })
  }
})


