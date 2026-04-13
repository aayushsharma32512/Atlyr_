// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

import { corsHeaders, requireUser } from "../_shared/auth.ts"
import { createSignedUrl } from "../_shared/storage.ts"

const FINAL_BUCKET = "neutral-poses"

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "GET") {
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
    const { data, error } = await auth.adminClient
      .from("user_neutral_poses")
      .select("id, storage_path, is_active, created_at, metadata")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })

    if (error) {
      throw new Error(error.message)
    }

    const poses = await Promise.all(
      (data ?? []).map(async (pose) => {
        const signed = pose.storage_path
          ? await createSignedUrl(FINAL_BUCKET, pose.storage_path, 900).catch(() => null)
          : null
        return {
          id: pose.id,
          createdAt: pose.created_at,
          isActive: pose.is_active,
          imagePath: pose.storage_path,
          imageUrl: signed?.signedUrl ?? null,
          metadata: pose.metadata ?? {},
        }
      }),
    )

    console.log("[LikenessList] fetched", { userId: auth.userId, count: poses.length, correlationId: auth.correlationId })

    return new Response(JSON.stringify({ status: "ok", poses, correlationId: auth.correlationId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("[LikenessList] error", { error: (error as Error).message })
    return new Response(JSON.stringify({ status: "error", code: "E_LIST_FAILED" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})


