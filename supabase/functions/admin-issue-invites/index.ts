// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, requireUser } from "../_shared/auth.ts"

function parseAllowlist(raw: string | undefined) {
  if (!raw) return []
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function parseEmails(raw: string[]) {
  return Array.from(
    new Set(
      raw
        .map((entry) => (entry ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

function generateInviteCode() {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()
  return `ATLYR_${suffix}`
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const ctx = await requireUser(req)
  if (!ctx.userId) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { data: { user } } = await ctx.authClient.auth.getUser()
  const email = user?.email?.toLowerCase() ?? null
  const allowlist = parseAllowlist(Deno.env.get("ADMIN_INVITE_EMAILS"))

  if (!email || !allowlist.includes(email)) {
    return new Response(JSON.stringify({ error: "FORBIDDEN" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  let payload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const mode = payload?.mode
  const count = payload?.count
  const emails = payload?.emails
  const expiresInDays = Number(payload?.expiresInDays ?? 7)

  if (mode !== "count" && mode !== "emails") {
    return new Response(JSON.stringify({ error: "INVALID_MODE" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (mode === "count" && (!Number.isFinite(count) || count <= 0)) {
    return new Response(JSON.stringify({ error: "INVALID_COUNT" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (mode === "emails" && (!Array.isArray(emails) || emails.length === 0)) {
    return new Response(JSON.stringify({ error: "INVALID_EMAILS" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
    return new Response(JSON.stringify({ error: "INVALID_EXPIRY" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const issued = []
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  const supabase = ctx.adminClient

  if (mode === "count") {
    const { data: waitlistRows, error } = await supabase
      .from("waitlist")
      .select("id,email,status,invite_code,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(count)

    if (error) {
      return new Response(JSON.stringify({ error: "WAITLIST_QUERY_FAILED", detail: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    for (const row of waitlistRows ?? []) {
      if (row.invite_code) {
        issued.push({ email: row.email, invite: row.invite_code, status: "already_invited" })
        continue
      }

      const code = generateInviteCode()
      const { error: inviteInsertError } = await supabase.from("invite_codes").insert({
        code,
        type: "waitlist_invite",
        is_active: true,
        max_uses: 1,
        expires_at: expiresAt,
        metadata: { waitlist_id: row.id, email: row.email, issued_by: email },
      })

      if (inviteInsertError) {
        issued.push({ email: row.email, invite: null, status: "invite_insert_failed", reason: inviteInsertError.message })
        continue
      }

      const { error: waitlistUpdateError } = await supabase
        .from("waitlist")
        .update({ status: "invited", invited_at: new Date().toISOString(), invite_code: code })
        .eq("id", row.id)

      if (waitlistUpdateError) {
        issued.push({ email: row.email, invite: code, status: "waitlist_update_failed", reason: waitlistUpdateError.message })
        continue
      }

      issued.push({ email: row.email, invite: code, status: "invited" })
    }
  } else {
    const emailList = parseEmails(emails)
    const { data: waitlistRows, error } = await supabase
      .from("waitlist")
      .select("id,email,status,invite_code,created_at")
      .in("email", emailList)

    if (error) {
      return new Response(JSON.stringify({ error: "WAITLIST_QUERY_FAILED", detail: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const waitlistByEmail = new Map((waitlistRows ?? []).map((row) => [row.email.toLowerCase(), row]))

    for (const requestedEmail of emailList) {
      const row = waitlistByEmail.get(requestedEmail)
      if (!row) {
        issued.push({ email: requestedEmail, invite: null, status: "not_found" })
        continue
      }

      if (row.invite_code) {
        issued.push({ email: row.email, invite: row.invite_code, status: "already_invited" })
        continue
      }

      if (row.status !== "pending") {
        issued.push({ email: row.email, invite: null, status: "not_pending" })
        continue
      }

      const code = generateInviteCode()
      const { error: inviteInsertError } = await supabase.from("invite_codes").insert({
        code,
        type: "waitlist_invite",
        is_active: true,
        max_uses: 1,
        expires_at: expiresAt,
        metadata: { waitlist_id: row.id, email: row.email, issued_by: email },
      })

      if (inviteInsertError) {
        issued.push({ email: row.email, invite: null, status: "invite_insert_failed", reason: inviteInsertError.message })
        continue
      }

      const { error: waitlistUpdateError } = await supabase
        .from("waitlist")
        .update({ status: "invited", invited_at: new Date().toISOString(), invite_code: code })
        .eq("id", row.id)

      if (waitlistUpdateError) {
        issued.push({ email: row.email, invite: code, status: "waitlist_update_failed", reason: waitlistUpdateError.message })
        continue
      }

      issued.push({ email: row.email, invite: code, status: "invited" })
    }
  }

  return new Response(JSON.stringify({ issued }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
