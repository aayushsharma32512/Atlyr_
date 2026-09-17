import { supabase } from "@/integrations/supabase/client"

export type InviteIssueMode = "count" | "emails"

export type InviteIssueRequest = {
  mode: InviteIssueMode
  count?: number
  emails?: string[]
  expiresInDays?: number
}

export type InviteIssueItem = {
  email: string
  invite?: string | null
  status: string
  reason?: string
}

export type InviteIssueResponse = {
  issued: InviteIssueItem[]
}

export type WaitlistStatus = "pending" | "invited" | "converted" | "rejected"

export type WaitlistEntry = {
  id: string
  name: string | null
  email: string
  status: WaitlistStatus
  phone_number?: string | null
  created_at: string
  invited_at?: string | null
}

// Row counts for the whole table, not just the page that was fetched.
export type WaitlistTotals = Record<WaitlistStatus, number> & { all: number }

export type WaitlistPage = {
  waitlist: WaitlistEntry[]
  totals: WaitlistTotals
  hasMore: boolean
}

export const EMPTY_WAITLIST_TOTALS: WaitlistTotals = {
  pending: 0,
  invited: 0,
  converted: 0,
  rejected: 0,
  all: 0,
}

export type ListWaitlistOptions = {
  statuses?: WaitlistStatus[]
  limit?: number
  offset?: number
}

// One page of the waitlist in recency order (newest applicant first), plus the
// true per-status totals so callers never have to infer a count from page size.
export async function listWaitlist(opts: ListWaitlistOptions = {}): Promise<WaitlistPage> {
  const { data, error } = await supabase.functions.invoke("admin-issue-invites", {
    body: { action: "list", ...opts },
  })
  if (error) throw new Error(error.message)
  const page = data as Partial<WaitlistPage> | null
  return {
    waitlist: page?.waitlist ?? [],
    totals: page?.totals ?? EMPTY_WAITLIST_TOTALS,
    hasMore: page?.hasMore ?? false,
  }
}

// Approve (→ invited, grants access) or reject (→ rejected) a single email.
export async function setWaitlistApproval(email: string, action: "approve" | "reject"): Promise<string> {
  const { data, error } = await supabase.functions.invoke("admin-issue-invites", { body: { action, emails: [email] } })
  if (error) throw new Error(error.message)
  const r = (data as { results?: { status: string; reason?: string }[] })?.results?.[0]
  if (!r) throw new Error("No result from server")
  if (r.status !== "invited" && r.status !== "rejected") throw new Error(r.reason || r.status)
  return r.status
}

export async function issueWaitlistInvites(payload: InviteIssueRequest): Promise<InviteIssueResponse> {
  const { data, error } = await supabase.functions.invoke("admin-issue-invites", {
    body: payload,
  })

  if (error) {
    const wrapped = new Error(error.message) as Error & { status?: number }
    wrapped.status = error.status
    throw wrapped
  }

  if (!data || typeof data !== "object") {
    throw new Error("Unexpected response from invite service")
  }

  return data as InviteIssueResponse
}

// ── Invite codes (shareable codes that grant access without a waitlist approval) ──

export type InviteCode = {
  id: string
  code: string
  type: "beta" | "waitlist_invite" | "special"
  is_active: boolean
  max_uses: number | null
  current_uses: number
  expires_at: string | null
  created_at: string
  metadata: { label?: string | null; issued_by?: string | null; shared_at?: string | null } | null
}

export type InviteCodeBulkOp = "activate" | "deactivate" | "mark_shared" | "unmark_shared"

export type CreateInviteCodesRequest = {
  count: number
  maxUses: number
  expiresInDays: number | null   // null = never expires
  label?: string
  customCode?: string            // vanity code; when set, count is ignored
}

// Fixed error text per server code so the UI never shows a raw upstream message.
const CREATE_ERRORS: Record<string, string> = {
  CODE_TAKEN: "That code already exists.",
  INVALID_CODE: "Custom codes: 4–24 letters, digits or dashes.",
  INVALID_COUNT: "Count must be between 1 and 200.",
  INVALID_MAX_USES: "Max uses must be at least 1.",
  INVALID_EXPIRY: "Expiry must be a positive number of days.",
}

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-issue-invites", { body })
  if (error) {
    // supabase-js hides the JSON body on non-2xx; read it back to map the server's error code.
    const ctx = (error as { context?: Response }).context
    const serverError = ctx ? await ctx.clone().json().then((b) => b?.error).catch(() => null) : null
    throw new Error(CREATE_ERRORS[serverError] ?? error.message)
  }
  return data as T
}

export async function listInviteCodes(): Promise<InviteCode[]> {
  const res = await invokeAdmin<{ codes?: InviteCode[] }>({ action: "codes_list" })
  return res?.codes ?? []
}

export async function createInviteCodes(req: CreateInviteCodesRequest): Promise<InviteCode[]> {
  const res = await invokeAdmin<{ codes?: InviteCode[] }>({ action: "codes_create", ...req })
  return res?.codes ?? []
}

export async function setInviteCodeActive(id: string, isActive: boolean): Promise<void> {
  await invokeAdmin<{ ok: boolean }>({ action: "codes_set_active", id, isActive })
}

export async function bulkUpdateInviteCodes(ids: string[], op: InviteCodeBulkOp): Promise<void> {
  await invokeAdmin<{ ok: boolean }>({ action: "codes_bulk", ids, op })
}
