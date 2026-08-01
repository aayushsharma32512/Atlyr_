// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, requireUser } from "../_shared/auth.ts"

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
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

  // Admin gate: profiles.role = 'admin' — the same source of truth as the app's
  // AdminAccessGuard. (Replaces the old ADMIN_INVITE_EMAILS env allowlist, which
  // kept drifting from the DB role.)
  const { data: callerProfile } = await ctx.adminClient
    .from("profiles")
    .select("role")
    .eq("user_id", ctx.userId)
    .maybeSingle()

  if (callerProfile?.role !== "admin") {
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

  // ── Email-approval actions: list waitlist / approve / reject ──────────────
  const action = payload?.action
  if (action === "list") {
    const { data, error } = await ctx.adminClient
      .from("waitlist")
      .select("id,name,email,status,phone_number,created_at,invited_at")
      .order("created_at", { ascending: false })   // recency: newest applicant on top
      .limit(Number(payload?.limit ?? 300))
    if (error) return json({ error: "LIST_FAILED", detail: error.message }, 500)
    return json({ waitlist: data ?? [] }, 200)
  }
  if (action === "approve" || action === "reject") {
    const list = parseEmails(Array.isArray(payload?.emails) ? payload.emails : [])
    if (!list.length) return json({ error: "INVALID_EMAILS" }, 400)
    const results = []
    for (const em of list) {
      const { data: existing } = await ctx.adminClient
        .from("waitlist").select("id").ilike("email", em).maybeSingle()
      if (action === "reject") {
        if (!existing) { results.push({ email: em, status: "not_found" }); continue }
        const { error } = await ctx.adminClient.from("waitlist").update({ status: "rejected" }).eq("id", existing.id)
        results.push({ email: em, status: error ? "update_failed" : "rejected", ...(error ? { reason: error.message } : {}) })
        continue
      }
      // approve → mark invited (grants access). Insert if the email isn't on the waitlist yet.
      if (!existing) {
        const { error } = await ctx.adminClient.from("waitlist")
          .insert({ name: em.split("@")[0], email: em, status: "invited", invited_at: new Date().toISOString(), source: "admin_direct" })
        results.push({ email: em, status: error ? "insert_failed" : "invited", ...(error ? { reason: error.message } : {}) })
        continue
      }
      const { error } = await ctx.adminClient.from("waitlist")
        .update({ status: "invited", invited_at: new Date().toISOString() }).eq("id", existing.id)
      results.push({ email: em, status: error ? "update_failed" : "invited", ...(error ? { reason: error.message } : {}) })
    }
    return json({ ok: true, action, results }, 200)
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
        // Email-approval flow: an admin can approve any email directly, even one that never
        // joined the waitlist. Insert it already marked `invited` (no code — approval alone
        // grants access via has_app_access()).
        const { error: insertError } = await supabase.from("waitlist").insert({
          name: requestedEmail.split("@")[0],
          email: requestedEmail,
          status: "invited",
          invited_at: new Date().toISOString(),
          source: "admin_direct",
        })

        if (insertError) {
          issued.push({ email: requestedEmail, invite: null, status: "insert_failed", reason: insertError.message })
          continue
        }

        issued.push({ email: requestedEmail, invite: null, status: "invited_direct" })
        continue
      }

      // invited/converted = already approved — in the email-approval flow that means they
      // already have access (code or not), so report it as success, not "not_pending".
      if (row.status === "invited" || row.status === "converted") {
        issued.push({ email: row.email, invite: row.invite_code ?? null, status: "already_approved" })
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
