// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

import { corsHeaders, requireUser } from "../_shared/auth.ts"
import { deleteObjects } from "../_shared/storage.ts"

const FINAL_BUCKET = "neutral-poses"
const GENERATIONS_BUCKET = "generations"

type DeleteBody = {
  poseId?: string
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
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
    const body: DeleteBody = req.method === "DELETE" ? { poseId: new URL(req.url).searchParams.get("poseId") } : await req.json()
    if (!body.poseId) {
      return new Response(JSON.stringify({ status: "error", code: "E_BAD_REQUEST" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: pose, error } = await auth.adminClient
      .from("user_neutral_poses")
      .select("id, storage_path")
      .eq("id", body.poseId)
      .eq("user_id", auth.userId)
      .maybeSingle()

    if (error || !pose) {
      return new Response(JSON.stringify({ status: "error", code: "E_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: generations, error: generationsError } = await auth.adminClient
      .from("user_generations")
      .select("id, storage_path")
      .eq("neutral_pose_id", body.poseId)

    if (generationsError) {
      throw new Error(generationsError.message)
    }

    if (generations && generations.length > 0) {
      const generationPaths = generations.map((g) => g.storage_path).filter(Boolean)
      if (generationPaths.length > 0) {
        await deleteObjects(GENERATIONS_BUCKET, generationPaths)
      }
      await auth.adminClient.from("user_generations").delete().eq("neutral_pose_id", body.poseId)
    }

    await auth.adminClient.from("user_neutral_poses").delete().eq("id", body.poseId)

    if (pose.storage_path) {
      await deleteObjects(FINAL_BUCKET, [pose.storage_path])
    }

    console.log("[LikenessDelete] removed", { userId: auth.userId, poseId: body.poseId, correlationId: auth.correlationId })

    return new Response(JSON.stringify({ status: "ok", deleted: true, correlationId: auth.correlationId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("[LikenessDelete] error", { error: (error as Error).message })
    return new Response(JSON.stringify({ status: "error", code: "E_DELETE_FAILED" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})


