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
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function generateBetaCode() {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 3).toUpperCase()
  return `ATLYR_${suffix}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const maxUses = args.has("max-uses") ? Number(args.get("max-uses")) : 60
  if (!Number.isFinite(maxUses) || maxUses <= 0) {
    throw new Error("--max-uses must be a positive number")
  }

  const expiresInDays = args.has("expires-in-days") ? Number(args.get("expires-in-days")) : 3
  if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
    throw new Error("--expires-in-days must be a positive number")
  }

  const code = args.has("code") ? String(args.get("code")).toUpperCase() : generateBetaCode()

  const supabaseUrl = requireEnv("SUPABASE_URL")
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Check if this code already exists
  const { data: existing } = await supabase
    .from("invite_codes")
    .select("code,is_active,max_uses,current_uses,expires_at")
    .eq("code", code)
    .maybeSingle()

  if (existing) {
    console.log("Beta pass code already exists:")
    printSummary(existing.code, existing.max_uses, existing.current_uses, new Date(existing.expires_at))
    return
  }

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

  const { error } = await supabase.from("invite_codes").insert({
    code,
    type: "beta",
    is_active: true,
    max_uses: maxUses,
    expires_at: expiresAt.toISOString(),
    metadata: { created_for: "beta_testing", created_at: new Date().toISOString() },
  })

  if (error) throw new Error(`Failed to create beta pass: ${error.message}`)

  console.log("Beta pass code created successfully!")
  printSummary(code, maxUses, 0, expiresAt)
}

function printSummary(code, maxUses, currentUses, expiresAt) {
  console.log("")
  console.log(`  Code:       ${code}`)
  console.log(`  Max uses:   ${maxUses}`)
  console.log(`  Used:       ${currentUses}`)
  console.log(`  Expires:    ${expiresAt.toLocaleString()}`)
  console.log("")
  console.log("Share this code with your beta testers.")
  console.log("They enter it on the signup page exactly as shown above.")
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
