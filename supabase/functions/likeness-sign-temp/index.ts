// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

import { corsHeaders, requireUser } from "../_shared/auth.ts"
import { createSignedUrl } from "../_shared/storage.ts"

const TEMP_BUCKET = "temp-candidates"

type SignBody = {
  path?: string
  expiresInSeconds?: number
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
    const body: SignBody = await req.json()
    if (!body.path || !body.path.startsWith(`${auth.userId}/`)) {
      return new Response(JSON.stringify({ status: "error", code: "E_BAD_REQUEST" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    const expiresInSeconds = Math.max(60, Math.min(3600, body.expiresInSeconds ?? 300))
    const signed = await createSignedUrl(TEMP_BUCKET, body.path, expiresInSeconds)
    console.log("[LikenessSignTemp] issued", { userId: auth.userId, path: body.path, expiresInSeconds, correlationId: auth.correlationId })
    return new Response(JSON.stringify({ status: "ok", signedUrl: signed?.signedUrl, correlationId: auth.correlationId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("[LikenessSignTemp] error", { error: (error as Error).message })
    return new Response(JSON.stringify({ status: "error", code: "E_SIGN_FAILED" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})


