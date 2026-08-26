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
