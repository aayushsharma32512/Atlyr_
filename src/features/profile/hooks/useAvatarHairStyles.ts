import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { profileKeys } from "@/features/profile/queryKeys"
import { avatarHairStylesService, type AvatarHairGender, type AvatarHairStyleRecord } from "@/services/profile/avatarHairStylesService"

export function getAvatarHairStylesQueryOptions(gender: AvatarHairGender | null) {
  return {
    queryKey: profileKeys.avatarHairStyles(gender),
    queryFn: () => avatarHairStylesService.fetchAvatarHairStylesByGender(gender as AvatarHairGender),
    enabled: Boolean(gender),
    staleTime: 30 * 60 * 1000,
  }
}

export function useAvatarHairStyles(gender: AvatarHairGender | null) {
  const query = useQuery(getAvatarHairStylesQueryOptions(gender))

  const byId = useMemo(() => {
    const map = new Map<string, AvatarHairStyleRecord>()
    ;(query.data ?? []).forEach((style) => map.set(style.id, style))
    return map
  }, [query.data])

  const defaultStyle = useMemo(() => (query.data ?? []).find((style) => style.isDefault) ?? null, [query.data])

  return {
    ...query,
    data: query.data ?? [],
    byId,
    defaultStyle,
  }
}

