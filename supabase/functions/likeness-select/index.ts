// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

import { corsHeaders, requireUser } from "../_shared/auth.ts"
import { downloadObject, deleteObjects, putObject, createSignedUrl } from "../_shared/storage.ts"

const TEMP_BUCKET = "temp-candidates"
const FINAL_BUCKET = "neutral-poses"

type SelectPayload = {
  candidateId: string
  setActive?: boolean
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
    console.log("[LikenessSelect] start", { userId: auth.userId, correlationId: auth.correlationId })
    const body: SelectPayload = await req.json()
    
    if (!body.candidateId || typeof body.candidateId !== "string") {
      return new Response(JSON.stringify({ status: "error", code: "E_MISSING_CANDIDATE_ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const userId = auth.userId

    // Initialize Supabase client to query likeness_candidates
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Look up candidate record from database
    const { data: candidate, error: queryError } = await supabase
      .from("likeness_candidates")
      .select("*")
      .eq("id", body.candidateId)
      .eq("user_id", userId)
      .single()

    if (queryError || !candidate) {
      console.error("[LikenessSelect] candidate not found", {
        candidateId: body.candidateId,
        error: queryError?.message,
        correlationId: auth.correlationId,
      })
      return new Response(JSON.stringify({ status: "error", code: "E_CANDIDATE_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const batchId = candidate.batch_id
    const candidatePath = candidate.storage_path
    const metadataPath = `${userId}/${batchId}/metadata.json`

    const [candidateBytes, metadataBytes] = await Promise.all([
      downloadObject(TEMP_BUCKET, candidatePath),
      downloadObject(TEMP_BUCKET, metadataPath).catch(() => new Uint8Array()),
    ])

    const metadataJson = metadataBytes.length ? JSON.parse(new TextDecoder().decode(metadataBytes)) : {}

    const sources = Array.isArray(metadataJson.sources) ? metadataJson.sources : []
    const identitySummary = candidate.identity_summary ?? metadataJson.identitySummary ?? null
    const selfieSource = sources.find((s: any) => s.type === "selfie")?.path
    const fullBodySource = sources.find((s: any) => s.type === "fullBody")?.path
    
    if (!selfieSource || !fullBodySource) {
      throw new Error("MISSING_SOURCE_PATHS")
    }

    const poseMetadata = {
      identitySummary,
      uploadBatchId: batchId,
      candidateId: body.candidateId,
      candidateIndex: candidate.candidate_index,
      metadata: metadataJson.metadata ?? {},
      sources,
    }

    const poseId = crypto.randomUUID()
    const finalPath = `${userId}/${poseId}.png`

    await putObject(FINAL_BUCKET, finalPath, candidateBytes, "image/png")
    const signedFinal = await createSignedUrl(FINAL_BUCKET, finalPath, 900).catch(() => null)

    const { error: insertError } = await auth.adminClient.from("user_neutral_poses").insert({
      id: poseId,
      user_id: userId,
      storage_path: finalPath,
      original_fullbody_path: fullBodySource,
      original_selfie_path: selfieSource,
      status: "ready",
      is_active: false,
      metadata: poseMetadata,
    })

    if (insertError) {
      console.error("[LikenessSelect] insert error", { err: insertError.message, correlationId: auth.correlationId })
      return new Response(JSON.stringify({ status: "error", code: "E_DB_INSERT" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (body.setActive) {
      await auth.adminClient.from("user_neutral_poses").update({ is_active: false }).eq("user_id", userId)
      await auth.adminClient.from("user_neutral_poses").update({ is_active: true }).eq("id", poseId)
    }

    // Query all candidates for this batch to cleanup
    const { data: batchCandidates } = await supabase
      .from("likeness_candidates")
      .select("storage_path")
      .eq("batch_id", batchId)

    const cleanupPaths: string[] = [metadataPath]
    cleanupPaths.push(...sources.map((source: any) => source.path).filter(Boolean))
    
    if (batchCandidates) {
      cleanupPaths.push(...batchCandidates.map((c: any) => c.storage_path).filter(Boolean))
    }
    
    await deleteObjects(TEMP_BUCKET, cleanupPaths.filter(Boolean))

    // Delete candidate records from database
    await supabase
      .from("likeness_candidates")
      .delete()
      .eq("batch_id", batchId)

    console.log("[LikenessSelect] completed", {
      userId,
      batchId,
      poseId,
      candidateId: body.candidateId,
      correlationId: auth.correlationId,
    })

    return new Response(
      JSON.stringify({
        status: "ok",
        neutralPoseId: poseId,
        storagePath: finalPath,
        imageUrl: signedFinal?.signedUrl ?? null,
        identitySummary,
        isActive: !!body.setActive,
        correlationId: auth.correlationId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    console.error("[LikenessSelect] error", { error: (error as Error).message })
    return new Response(JSON.stringify({ status: "error", code: "E_SELECT_FAILED" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
