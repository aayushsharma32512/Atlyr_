import { supabase, SUPABASE_URL_FOR_FUNCTIONS } from "@/integrations/supabase/client"
import { getOrSignInAnon } from "@/utils/auth"

const FUNCTION_BASE = `${SUPABASE_URL_FOR_FUNCTIONS}/functions/v1`

export type LikenessUploadPayload = {
  selfie: File
  fullBody: File
  height?: string | null
  weight?: string | null
  skinTone?: string | null
  candidateCount?: number
  parallelStreams?: number
  uploadBatchId?: string | null
}

export type LikenessSource = {
  type: "selfie" | "fullBody"
  path: string
  mimeType: string
}

export type LikenessCandidate = {
  index: number
  path: string
  mimeType: string
  signedUrl: string | null
  summary?: string | null
}

export type LikenessUploadResponse = {
  status: "ok"
  uploadBatchId: string
  identitySummary: string | null
  summaries?: Array<{ index: number; summary: string }>
  metadata: {
    height?: string | null
    weight?: string | null
    skinTone?: string | null
  }
  sources: LikenessSource[]
  candidates: LikenessCandidate[]
  candidateCount: number
  parallelStreams?: number
  correlationId: string
}

export type LikenessSelectResponse = {
  status: "ok"
  neutralPoseId: string
  storagePath: string
  imageUrl: string | null
  identitySummary: string | null
  isActive: boolean
  correlationId: string
}

export type LikenessPose = {
  id: string
  createdAt: string
  isActive: boolean
  imagePath: string
  imageUrl: string | null
  metadata: Record<string, unknown>
}

async function buildAuthHeaders({ json = true }: { json?: boolean } = {}) {
  await getOrSignInAnon()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const headers = new Headers()
  if (json) {
    headers.set("Content-Type", "application/json")
  }
  headers.set("x-correlation-id", crypto.randomUUID())
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`)
  }
  return headers
}

const LIKENESS_LIMIT = 3

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
 * Check if user has reached daily likeness generation limit.
 * Counts both saved poses AND pending candidate batches created today (IST).
 * Resets at 12 AM IST every day.
 * @param pendingCount - Number of likeness generations currently in-flight (not yet in DB)
 */
export async function checkLikenessLimit(pendingCount = 0): Promise<{ allowed: boolean; count: number; limit: number }> {
  await getOrSignInAnon()
  
  const startOfDayIST = getStartOfDayIST()
  
  // Count saved neutral poses created today
  const { count: savedCount, error: savedError } = await supabase
    .from("user_neutral_poses")
    .select("*", { count: "exact", head: true })
    .gte("created_at", startOfDayIST)
  
  if (savedError) {
    console.error("Failed to check likeness limit (saved):", savedError)
    throw new Error("Unable to verify likeness limit")
  }
  
  // Count distinct pending candidate batches created today
  const { data: pendingBatches, error: batchError } = await supabase
    .from("likeness_candidates")
    .select("batch_id, created_at")
    .gte("created_at", startOfDayIST)
  
  if (batchError) {
    console.error("Failed to check likeness limit (pending):", batchError)
    throw new Error("Unable to verify likeness limit")
  }
  
  const pendingBatchCount = pendingBatches 
    ? new Set(pendingBatches.map((b) => b.batch_id)).size 
    : 0
  
  const dbCount = (savedCount ?? 0) + pendingBatchCount
  const totalCount = dbCount + pendingCount
  
  return {
    allowed: totalCount < LIKENESS_LIMIT,
    count: totalCount,
    limit: LIKENESS_LIMIT,
  }
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

export async function uploadLikeness(payload: LikenessUploadPayload): Promise<LikenessUploadResponse> {
  const formData = new FormData()
  formData.append("selfie", payload.selfie)
  formData.append("fullBody", payload.fullBody)
  if (payload.height) formData.append("height", payload.height)
  if (payload.weight) formData.append("weight", payload.weight)
  if (payload.skinTone) formData.append("skinTone", payload.skinTone)
  if (payload.uploadBatchId) formData.append("uploadBatchId", payload.uploadBatchId)
  if (payload.candidateCount) formData.append("candidateCount", String(payload.candidateCount))

  const headers = await buildAuthHeaders({ json: false })
  const response = await fetch(`${FUNCTION_BASE}/likeness-upload`, {
    method: "POST",
    headers,
    body: formData,
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Prefer message field for user-friendly errors, fall back to code
    const message = typeof json?.message === "string"
      ? json.message
      : typeof json?.code === "string"
        ? json.code
        : `upload failed: ${response.status}`
    throw new Error(message)
  }
  return json as LikenessUploadResponse
}

export async function selectLikeness(body: {
  candidateId: string
  setActive?: boolean
}): Promise<LikenessSelectResponse> {
  const headers = await buildAuthHeaders()
  return fetchJson<LikenessSelectResponse>("likeness-select", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

export async function listLikeness(): Promise<LikenessPose[]> {
  const headers = await buildAuthHeaders()
  const result = await fetchJson<{ poses: LikenessPose[] }>("likeness-list", {
    method: "GET",
    headers,
  })
  return Array.isArray(result.poses) ? result.poses : []
}

export async function setActiveLikeness(poseId: string) {
  const headers = await buildAuthHeaders()
  await fetchJson("likeness-set-active", {
    method: "POST",
    headers,
    body: JSON.stringify({ poseId }),
  })
}

export async function deleteLikeness(poseId: string) {
  const headers = await buildAuthHeaders()
  await fetchJson("likeness-delete", {
    method: "POST",
    headers,
    body: JSON.stringify({ poseId }),
  })
}

export async function signTempCandidate(path: string) {
  const headers = await buildAuthHeaders()
  const result = await fetchJson<{ signedUrl?: string }>("likeness-sign-temp", {
    method: "POST",
    headers,
    body: JSON.stringify({ path }),
  })
  return result.signedUrl ?? null
}


