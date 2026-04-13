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
