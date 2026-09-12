import { useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { useResolveShareLink } from "@/features/share/hooks/useShareLink"
import { isSafeSharePath } from "@/services/share/shareLinkSlug"

const FALLBACK = "/studio"

/**
 * `/s/:slug` — swap the short link for the long Studio path and go there. The
 * target carries `share=1`, which `ShareAccessGuard` already admits without a
 * session, so this route sits outside the guard and renders nothing itself.
 */
export default function ShareLinkRedirect() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const link = useResolveShareLink(slug)

  useEffect(() => {
    if (link.isPending) return
    const path = link.data
    navigate(path && isSafeSharePath(path) ? path : FALLBACK, { replace: true })
  }, [link.data, link.isPending, navigate])

  return null
}
