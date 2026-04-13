import { useMemo } from "react"
import { useSearchParams } from "react-router-dom"

import { useAuth } from "@/contexts/AuthContext"
import { parseStudioSearchParams } from "@/features/studio/utils/studioUrlState"

export function useStudioShareMode() {
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const isShareLink = useMemo(
    () => parseStudioSearchParams(searchParams).share === true,
    [searchParams],
  )

  return {
    isShareLink,
    isViewOnly: isShareLink && !user,
  }
}
