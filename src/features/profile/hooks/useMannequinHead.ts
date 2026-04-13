import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { mannequinService } from "@/services/studio/mannequinService"
import { profileKeys } from "@/features/profile/queryKeys"
import {
  applySkinToneToSvg,
  buildSvgDataUrl,
  DEFAULT_MANNEQUIN_BODY_TYPE,
  type MannequinGender,
} from "@/features/profile/utils/mannequin"

interface UseMannequinHeadOptions {
  gender: MannequinGender | null
  skinTone: string | null
}

async function fetchHeadSvg(gender: MannequinGender) {
  const config = await mannequinService.fetchMannequinConfig({
    gender,
    bodyType: DEFAULT_MANNEQUIN_BODY_TYPE,
  })
  const headAssetUrl = config?.segments?.head?.assetUrl
  if (!headAssetUrl) {
    throw new Error("Missing head asset url for mannequin")
  }
  const response = await fetch(headAssetUrl)
  if (!response.ok) {
    throw new Error("Failed to load mannequin head svg")
  }
  return response.text()
}

export function useMannequinHead({ gender, skinTone }: UseMannequinHeadOptions) {
  const bodyType = DEFAULT_MANNEQUIN_BODY_TYPE
  const baseQuery = useQuery({
    queryKey: profileKeys.mannequinHeadSvg(gender, bodyType),
    queryFn: () => fetchHeadSvg(gender as MannequinGender),
    enabled: Boolean(gender),
    staleTime: 10 * 60 * 1000,
  })

  const headUrl = useMemo(() => {
    if (!baseQuery.data) {
      return null
    }
    const svgMarkup = skinTone ? applySkinToneToSvg(baseQuery.data, skinTone) : baseQuery.data
    return buildSvgDataUrl(svgMarkup)
  }, [baseQuery.data, skinTone])

  return {
    headUrl,
    baseSvg: baseQuery.data ?? null,
    isLoading: baseQuery.isLoading,
    error: baseQuery.error,
  }
}
