// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

import { corsHeaders, requireUser } from "../_shared/auth.ts"

type SetActiveBody = {
  poseId?: string
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
    const body: SetActiveBody = await req.json()
    if (!body.poseId) {
      return new Response(JSON.stringify({ status: "error", code: "E_BAD_REQUEST" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: pose, error } = await auth.adminClient
      .from("user_neutral_poses")
      .select("id")
      .eq("id", body.poseId)
      .eq("user_id", auth.userId)
      .maybeSingle()

    if (error || !pose) {
      return new Response(JSON.stringify({ status: "error", code: "E_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    await auth.adminClient.from("user_neutral_poses").update({ is_active: false }).eq("user_id", auth.userId)
    await auth.adminClient.from("user_neutral_poses").update({ is_active: true }).eq("id", body.poseId)

    console.log("[LikenessSetActive] updated", { userId: auth.userId, poseId: body.poseId, correlationId: auth.correlationId })

    return new Response(JSON.stringify({ status: "ok", poseId: body.poseId, correlationId: auth.correlationId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("[LikenessSetActive] error", { error: (error as Error).message })
    return new Response(JSON.stringify({ status: "error", code: "E_SET_ACTIVE_FAILED" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})


