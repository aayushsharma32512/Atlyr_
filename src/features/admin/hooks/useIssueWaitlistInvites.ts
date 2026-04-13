import { useMutation } from "@tanstack/react-query"

import { adminKeys } from "@/features/admin/queryKeys"
import { issueWaitlistInvites, type InviteIssueRequest } from "@/services/admin/inviteAdminService"

export function useIssueWaitlistInvites() {
  return useMutation({
    mutationKey: adminKeys.issueInvites(),
    mutationFn: (payload: InviteIssueRequest) => issueWaitlistInvites(payload),
  })
}
