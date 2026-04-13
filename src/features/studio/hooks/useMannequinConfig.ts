import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { mannequinService } from "@/services/studio/mannequinService"
import type { MannequinConfig } from "@/features/studio/types"

interface UseMannequinConfigOptions {
  gender?: "male" | "female" | null
  bodyType?: string | null
  enabled?: boolean
}

type MannequinQueryArgs = {
  gender: "male" | "female"
  bodyType?: string | null
}

export function getMannequinConfigQueryOptions({ gender, bodyType }: MannequinQueryArgs) {
  return {
    queryKey: studioKeys.mannequin(gender, bodyType ?? null),
    queryFn: () =>
      mannequinService.fetchMannequinConfig({
        gender,
        bodyType: bodyType ?? undefined,
      }),
    staleTime: Infinity,
  }
}

export function useMannequinConfig({
  gender,
  bodyType,
  enabled = true,
}: UseMannequinConfigOptions): {
  data: MannequinConfig | null | undefined
  isLoading: boolean
  isError: boolean
} {
  const effectiveGender = gender ?? null
  const queryOptions = effectiveGender
    ? getMannequinConfigQueryOptions({ gender: effectiveGender, bodyType })
    : {
        queryKey: studioKeys.mannequin(effectiveGender, bodyType ?? null),
        queryFn: () => Promise.resolve(null),
        staleTime: Infinity,
      }

  return useQuery({
    ...queryOptions,
    enabled: enabled && Boolean(effectiveGender),
  })
}
