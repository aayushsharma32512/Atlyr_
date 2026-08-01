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

// Waitlist in recency order (newest applicant first).
export async function listWaitlist(limit = 300): Promise<WaitlistEntry[]> {
  const { data, error } = await supabase.functions.invoke("admin-issue-invites", { body: { action: "list", limit } })
  if (error) throw new Error(error.message)
  return ((data as { waitlist?: WaitlistEntry[] })?.waitlist ?? [])
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
