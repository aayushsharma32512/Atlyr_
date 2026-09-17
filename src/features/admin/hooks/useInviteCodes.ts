import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { adminKeys } from "@/features/admin/queryKeys"
import {
  createInviteCodes,
  listInviteCodes,
  setInviteCodeActive,
  type CreateInviteCodesRequest,
} from "@/services/admin/inviteAdminService"

export function useInviteCodesQuery() {
  return useQuery({
    queryKey: adminKeys.inviteCodes(),
    queryFn: listInviteCodes,
    staleTime: 30_000,
  })
}

export function useCreateInviteCodes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateInviteCodesRequest) => createInviteCodes(req),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.inviteCodes() }),
  })
}

export function useSetInviteCodeActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setInviteCodeActive(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.inviteCodes() }),
  })
}
