import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith("--")) {
      args.set(key, true)
    } else {
      args.set(key, next)
      index += 1
    }
  }
  return args
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function generateInviteCode() {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()
  return `ATLYR_${suffix}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const countArg = args.get("count")
  const emailsArg = args.get("emails")

  const count = countArg ? Number(countArg) : null
  if (countArg && (!Number.isFinite(count) || count <= 0)) {
    throw new Error("--count must be a positive number")
  }

  if (!count && !emailsArg) {
    throw new Error('Provide either "--count 50" or "--emails a@b.com,c@d.com"')
  }

  const supabaseUrl = requireEnv("SUPABASE_URL")
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  let waitlistQuery = supabase
    .from("waitlist")
    .select("id,email,name,status,invite_code,created_at")
    .eq("status", "pending")

  if (emailsArg) {
    const emails = String(emailsArg)
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
    waitlistQuery = waitlistQuery.in("email", emails)
  } else {
    waitlistQuery = waitlistQuery.order("created_at", { ascending: true }).limit(count)
  }

  const { data: waitlistRows, error: waitlistError } = await waitlistQuery
  if (waitlistError) {
    throw new Error(`Failed to load waitlist rows: ${waitlistError.message}`)
  }

  if (!waitlistRows || waitlistRows.length === 0) {
    console.log("No matching waitlist rows found.")
    return
  }

  const issued = []

  for (const row of waitlistRows) {
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
      metadata: { waitlist_id: row.id, email: row.email },
    })

    if (inviteInsertError) {
      issued.push({ email: row.email, invite: null, status: `invite_insert_failed:${inviteInsertError.message}` })
      continue
    }

    const { error: waitlistUpdateError } = await supabase
      .from("waitlist")
      .update({ status: "invited", invited_at: new Date().toISOString(), invite_code: code })
      .eq("id", row.id)

    if (waitlistUpdateError) {
      issued.push({ email: row.email, invite: code, status: `waitlist_update_failed:${waitlistUpdateError.message}` })
      continue
    }

    issued.push({ email: row.email, invite: code, status: "invited" })
  }

  console.log("Issued invites:")
  for (const item of issued) {
    console.log(`${item.email}\t${item.invite ?? ""}\t${item.status}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

