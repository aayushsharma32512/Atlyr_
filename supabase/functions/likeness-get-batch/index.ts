// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

import { corsHeaders, requireUser } from "../_shared/auth.ts"
import { createSignedUrl } from "../_shared/storage.ts"

const TEMP_BUCKET = "temp-candidates"
const SIGNED_URL_EXPIRY = 3600 // 1 hour

type CandidateRecord = {
  id: string
  batch_id: string
  candidate_index: number
  storage_path: string
  mime_type: string
  identity_summary: string | null
  created_at: string
}

type CandidateResponse = {
  index: number
  path: string
  mimeType: string
  signedUrl: string | null
  summary: string | null
  candidateId: string
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "error", code: "E_METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const auth = await requireUser(req)
  if (!auth.userId) {
    return new Response(JSON.stringify({ status: "error", code: "E_UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    console.log("[LikenessGetBatch] start", { userId: auth.userId, correlationId: auth.correlationId })

    // Parse request body
    const body = await req.json()
    const { batchId } = body

    if (!batchId || typeof batchId !== "string") {
      return new Response(JSON.stringify({ status: "error", code: "E_MISSING_BATCH_ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch candidates from database (RLS ensures user_id match)
    const { data: candidates, error: dbError } = await supabase
      .from("likeness_candidates")
      .select("*")
      .eq("batch_id", batchId)
      .eq("user_id", auth.userId)
      .order("candidate_index", { ascending: true })

    if (dbError) {
      console.error("[LikenessGetBatch] DB query failed", {
        error: dbError.message,
        batchId,
        correlationId: auth.correlationId,
      })
      return new Response(JSON.stringify({ status: "error", code: "E_DATABASE_ERROR" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ status: "error", code: "E_BATCH_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Generate signed URLs for each candidate
    const candidateResponses: CandidateResponse[] = []
    for (const record of candidates as CandidateRecord[]) {
      const signedResult = await createSignedUrl(TEMP_BUCKET, record.storage_path, SIGNED_URL_EXPIRY).catch(
        (err) => {
          console.error("[LikenessGetBatch] Signed URL failed", {
            path: record.storage_path,
            error: err.message,
            correlationId: auth.correlationId,
          })
          return null
        },
      )

      candidateResponses.push({
        index: record.candidate_index,
        path: record.storage_path,
        mimeType: record.mime_type,
        signedUrl: signedResult?.signedUrl ?? null,
        summary: record.identity_summary,
        candidateId: record.id,
      })
    }

    const responseBody = {
      status: "ok",
      batchId,
      candidates: candidateResponses,
      candidateCount: candidateResponses.length,
      correlationId: auth.correlationId,
    }

    console.log("[LikenessGetBatch] completed", {
      userId: auth.userId,
      batchId,
      candidateCount: candidateResponses.length,
      correlationId: auth.correlationId,
    })

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("[LikenessGetBatch] error", { error: (error as Error).message })
    return new Response(JSON.stringify({ status: "error", code: (error as Error).message ?? "E_FETCH_FAILED" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
