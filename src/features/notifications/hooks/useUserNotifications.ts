import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { notificationsKeys } from "@/features/notifications/queryKeys"
import { notificationsService } from "@/services/notifications/notificationsService"
import type { UserNotification } from "@/services/notifications/types"

export function useUserNotifications(limit = 30) {
  const { user } = useAuth()

  return useQuery<UserNotification[]>({
    queryKey: notificationsKeys.list(user?.id ?? null),
    enabled: Boolean(user?.id),
    queryFn: () => notificationsService.listRecent(limit),
    staleTime: 30_000,
    refetchInterval: 60_000,
    // A backgrounded tab polls nothing; the focus refetch catches it up on return.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

export function useMarkNotificationRead() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => notificationsService.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.list(user?.id ?? null) })
    },
  })
}
