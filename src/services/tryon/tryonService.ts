import { supabase, SUPABASE_URL_FOR_FUNCTIONS } from "@/integrations/supabase/client"
import { getOrSignInAnon } from "@/utils/auth"

const FUNCTION_BASE = `${SUPABASE_URL_FOR_FUNCTIONS}/functions/v1`

async function buildAuthHeaders({ json = true }: { json?: boolean } = {}) {
  await getOrSignInAnon()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers = new Headers()
  if (json) headers.set("Content-Type", "application/json")
  headers.set("x-correlation-id", crypto.randomUUID())
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`)
  }
  return headers
}

async function fetchJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${FUNCTION_BASE}/${path}`, init)
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Prefer message field for user-friendly errors, fall back to code
    const message = typeof json?.message === "string"
      ? json.message
      : typeof json?.code === "string"
        ? json.code
        : `Request failed: ${response.status}`
    throw new Error(message)
  }
  return json as T
}

export type TryOnEnsureResponse = {
  status: "ok"
  productId: string
  version: string
  physicsBlock: string | null
  correlationId: string
}

export async function ensureGarmentSummary(productId: string) {
  const headers = await buildAuthHeaders()
  return fetchJson<TryOnEnsureResponse>("tryon-generate-summary", {
    method: "POST",
    headers,
    body: JSON.stringify({ productId }),
  })
}

export type TryOnGeneratePayload = {
  neutralPoseId: string
  outfitItems: {
    topId?: string | null
    bottomId?: string | null
    footwearId?: string | null
  }
  outfitSnapshot?: {
    id: string
    name?: string | null
    category?: string | null
    occasion?: string | null
    background_id?: string | null
    gender?: string | null
    top_id?: string | null
    bottom_id?: string | null
    shoes_id?: string | null
  } | null
  // NOTE: generationId is generated server-side for security, client value is ignored
}

export type TryOnGenerateResponse = {
  status: "ready" | "queued" | "error"
  generationId: string
  outfitId: string
  storagePath: string
  signedUrl: string | null
  correlationId: string
}

export async function generateTryOn(payload: TryOnGeneratePayload) {
  const headers = await buildAuthHeaders()
  return fetchJson<TryOnGenerateResponse>("tryon-generate", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
}

export type TryOnGenerationRecord = {
  id: string
  created_at: string
  status: string
  storage_path: string | null
  metadata: Record<string, unknown> | null
}

export async function listGenerations() {
  await getOrSignInAnon()
  const { data, error } = await supabase
    .from("user_generations")
    .select("id, created_at, status, storage_path, metadata")
    .order("created_at", { ascending: false })
  if (error) {
    throw new Error(error.message)
  }
  return (data as TryOnGenerationRecord[]) ?? []
}

export async function getGeneration(generationId: string) {
  await getOrSignInAnon()
  const { data, error } = await supabase
    .from("user_generations")
    .select("id, created_at, status, storage_path, metadata")
    .eq("id", generationId)
    .maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  return (data as TryOnGenerationRecord | null) ?? null
}

const TRYON_LIMIT = 10

/**
 * Get start of current day in IST (12 AM IST = UTC+5:30).
 * Returns ISO string for Supabase query.
 */
function getStartOfDayIST(): string {
  const now = new Date()
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  // Get start of day in IST
  const istMidnight = new Date(istNow)
  istMidnight.setUTCHours(0, 0, 0, 0)
  // Convert back to UTC
  const utcMidnight = new Date(istMidnight.getTime() - istOffset)
  return utcMidnight.toISOString()
}

/**
 * Check if user has reached daily try-on generation limit.
 * Resets at 12 AM IST every day.
 * Call this FIRST before any other processing to fail fast.
 * @param pendingCount - Number of try-ons currently in-flight (not yet in DB)
 */
export async function checkTryOnLimit(pendingCount = 0): Promise<{ allowed: boolean; count: number; limit: number }> {
  await getOrSignInAnon()

  const startOfDayIST = getStartOfDayIST()

  const { count, error } = await supabase
    .from("user_generations")
    .select("*", { count: "exact", head: true })
    .gte("created_at", startOfDayIST)
    .neq("status", "failed")

  if (error) {
    throw new Error("Unable to check try-on limit")
  }

  const dbCount = count ?? 0
  const totalCount = dbCount + pendingCount
  return {
    allowed: totalCount < TRYON_LIMIT,
    count: totalCount,
    limit: TRYON_LIMIT,
  }
}
