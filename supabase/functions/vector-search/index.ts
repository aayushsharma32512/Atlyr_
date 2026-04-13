import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OpenAI } from 'https://esm.sh/openai@4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get the search query from the request body
    const { query, searchType = 'outfits', limit = 10, threshold = 0.1, category, gender, filters } = await req.json()
    
    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Query parameter is required and must be a string' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
    })

    console.log(`🔍 Vector search: query="${query}", type=${searchType}, limit=${limit}, threshold=${threshold}`)

    // Generate embedding for the search query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      encoding_format: 'float',
    })

    const embedding = embeddingResponse.data[0].embedding

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let results
    let error

    if (searchType === 'outfits') {
      // Search outfits using RPC function to avoid URI too long error
      const { data, error: searchError } = await supabase.rpc('search_outfits_by_vector', {
        query_embedding: embedding,
        match_threshold: threshold,
        // fetch a larger candidate set, then apply filters before slicing to limit
        match_count: Math.max(limit * 4, 100)
      })

      // Apply optional server-side filtering on the candidate set
      let interim: unknown[] | null = Array.isArray(data) ? data as unknown[] : null
      // Always hide outfits that are not meant for feed/search
      if (interim) {
        interim = (interim as { visible_in_feed?: boolean }[]).filter((row) => row?.visible_in_feed === true)
      }
      if (interim && filters) {
        const f = filters as Record<string, unknown>
        // Gender toggle or genders array; include unisex for a single gender
        const genders: string[] | undefined = Array.isArray(f.genders) ? (f.genders as string[]) : undefined
        const genderSingle: string | undefined = typeof gender === 'string' ? gender : undefined
        if (genders && genders.length > 0) {
          interim = (interim as { gender?: string }[]).filter((row) => row?.gender && genders.includes(row.gender as string))
        } else if (genderSingle) {
          interim = (interim as { gender?: string }[]).filter((row) => row?.gender === genderSingle || row?.gender === 'unisex')
        }

        const categories: string[] | undefined = Array.isArray(f.categories) ? (f.categories as string[]) : undefined
        if (categories && categories.length > 0) {
          interim = (interim as { category?: string }[]).filter((row) => row?.category && categories.includes(row.category as string))
        }

        const occasions: string[] | undefined = Array.isArray(f.occasions) ? (f.occasions as string[]) : undefined
        if (occasions && occasions.length > 0) {
          interim = (interim as { occasion?: string }[]).filter((row) => row?.occasion && occasions.includes(row.occasion as string))
        }

        const fits: string[] | undefined = Array.isArray(f.fits) ? (f.fits as string[]) : undefined
        if (fits && fits.length > 0) {
          interim = (interim as { fit?: string }[]).filter((row) => row?.fit && fits.includes(row.fit as string))
        }
      }

      // After filtering, enforce the requested limit
      results = (interim ?? data)?.slice(0, limit)
      error = searchError
    } else if (searchType === 'products') {
      // Search products using RPC function to avoid URI too long error
      const { data, error: searchError } = await supabase.rpc('search_products_by_vector', {
        query_embedding: embedding,
        match_threshold: threshold,
        // fetch a larger candidate set, then filter before slicing
        match_count: Math.max(limit * 4, 100)
      })
      // Apply optional server-side filtering on the candidate set
      let interim: unknown[] | null = Array.isArray(data) ? data as unknown[] : null
      if (interim) {
        // Category (item type) support - either via explicit param or filters.typeCategories
        if (category) {
          interim = (interim as { type?: string }[]).filter((row) => row?.type === category)
        }
        if (filters) {
          const f = filters as Record<string, unknown>

          // genders array takes precedence; include unisex when a single gender param is provided
          const genders: string[] | undefined = Array.isArray(f.genders) ? (f.genders as string[]) : undefined
          if (genders && genders.length > 0) {
            interim = (interim as { gender?: string }[]).filter((row) => row?.gender && genders.includes(row.gender as string))
          } else if (gender) {
            interim = (interim as { gender?: string }[]).filter((row) => row?.gender === gender || row?.gender === 'unisex')
          }

          const typeCategories: string[] | undefined = Array.isArray(f.typeCategories) ? (f.typeCategories as string[]) : undefined
          if (typeCategories && typeCategories.length > 0) {
            // prefer 'type_category' if present, fall back to 'type'
            interim = (interim as { type_category?: string; type?: string }[]).filter((row) => {
              const tc = row?.type_category ?? row?.type
              return !!tc && typeCategories.includes(tc as string)
            })
          }

          const brands: string[] | undefined = Array.isArray(f.brands) ? (f.brands as string[]) : undefined
          if (brands && brands.length > 0) {
            interim = (interim as { brand?: string }[]).filter((row) => row?.brand && brands.includes(row.brand as string))
          }

          const fits: string[] | undefined = Array.isArray(f.fits) ? (f.fits as string[]) : undefined
          if (fits && fits.length > 0) {
            interim = (interim as { fit?: string }[]).filter((row) => row?.fit && fits.includes(row.fit as string))
          }

          const feels: string[] | undefined = Array.isArray(f.feels) ? (f.feels as string[]) : undefined
          if (feels && feels.length > 0) {
            interim = (interim as { feel?: string }[]).filter((row) => row?.feel && feels.includes(row.feel as string))
          }

          const colorGroups: string[] | undefined = Array.isArray(f.colorGroups) ? (f.colorGroups as string[]) : undefined
          if (colorGroups && colorGroups.length > 0) {
            interim = (interim as { color_group?: string }[]).filter((row) => row?.color_group && colorGroups.includes(row.color_group as string))
          }

          const sizes: string[] | undefined = Array.isArray(f.sizes) ? (f.sizes as string[]) : undefined
          if (sizes && sizes.length > 0) {
            interim = (interim as { size?: string }[]).filter((row) => row?.size && sizes.includes(row.size as string))
          }

          const minPrice: number | undefined = typeof f.minPrice === 'number' ? (f.minPrice as number) : undefined
          const maxPrice: number | undefined = typeof f.maxPrice === 'number' ? (f.maxPrice as number) : undefined
          if (typeof minPrice === 'number') {
            interim = (interim as { price?: number }[]).filter((row) => typeof row?.price === 'number' && (row.price as number) >= minPrice)
          }
          if (typeof maxPrice === 'number') {
            interim = (interim as { price?: number }[]).filter((row) => typeof row?.price === 'number' && (row.price as number) <= maxPrice)
          }
        }
      }
      // After filtering, enforce the requested limit
      results = (interim ?? data)?.slice(0, limit)
      error = searchError
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid search type. Use "outfits" or "products"' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    if (error) {
      console.error('Supabase search error:', error)
      return new Response(
        JSON.stringify({ error: 'Database search failed', details: error.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`✅ Search complete: ${results?.length || 0} results found with threshold ${threshold}`)
    
    return new Response(
      JSON.stringify({ 
        results, 
        query, 
        searchType, 
        threshold,
        category: category ?? null,
        gender: gender ?? null,
        count: results?.length || 0 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Vector search function error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
