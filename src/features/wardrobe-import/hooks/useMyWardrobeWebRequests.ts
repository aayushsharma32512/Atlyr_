import { useQuery } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { inspirationImportKeys } from "@/features/inspiration-import/queryKeys"
import { inspirationImportService } from "@/services/inspirationImport/inspirationImportService"
import type { InspirationMyWebRequest } from "@/services/inspirationImport/types"

export function useMyWardrobeWebRequests() {
  const { user } = useAuth()

  return useQuery<InspirationMyWebRequest[]>({
    queryKey: inspirationImportKeys.myWardrobeWebRequests(user?.id ?? null),
    enabled: Boolean(user?.id),
    queryFn: () => inspirationImportService.listMyWebRequests(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}
