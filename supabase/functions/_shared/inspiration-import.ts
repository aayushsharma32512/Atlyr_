// Shared boundaries for the Inspiration Import Edge Functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

export const INSPIRATION_BUCKET = "inspiration-imports"
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

export function env(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function adminClient() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function requireUser(req: Request) {
  const authorization = req.headers.get("Authorization")
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "authentication_required", "Sign in again to continue")
  }
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new HttpError(401, "authentication_required", "Sign in again to continue")
  return { userId: data.user.id, client, admin: adminClient() }
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", "Request body must be an object")
  }
  return value as Record<string, unknown>
}

export function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_request", `${key} is required`)
  }
  return value.trim()
}

export function optionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new HttpError(400, "invalid_request", `${key} must be a string`)
  return value.trim() || null
}

export function publicError(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status)
  const message = error instanceof Error ? error.message : "Unknown error"
  console.error("[inspiration-import]", message)
  return json({ error: "internal_error", message: "The import request could not be completed" }, 500)
}

export async function signedUrl(admin: ReturnType<typeof adminClient>, path: string | null, ttl = 900) {
  if (!path) return null
  const { data, error } = await admin.storage.from(INSPIRATION_BUCKET).createSignedUrl(path, ttl)
  if (error || !data?.signedUrl) throw new Error(`Unable to sign image: ${error?.message ?? "missing URL"}`)
  return data.signedUrl
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const parsed = new URL(value)
    const isHttp = parsed.protocol === "https:" || parsed.protocol === "http:"
    const hostname = parsed.hostname.toLowerCase()
    const isLocal = hostname === "localhost" || hostname.endsWith(".localhost")
    if (!isHttp || !hostname || isLocal || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}
