import { useCallback } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { shareKeys } from "@/features/share/queryKeys"
import { createShareLink, resolveShareLink } from "@/services/share/shareLinksService"

export function useResolveShareLink(slug: string | null | undefined) {
  return useQuery({
    queryKey: shareKeys.link(slug),
    enabled: Boolean(slug),
    queryFn: () => resolveShareLink(slug as string),
    staleTime: Infinity, // a slug never changes what it points at
    retry: false,
  })
}

/**
 * Share a look: mint a short link, then hand it to the OS share sheet, else the
 * clipboard. Shortening is best-effort — if it fails (a guest with no session,
 * say) the long URL goes out instead, so a share never fails for lack of a slug.
 */
export function useShareLook() {
  const { toast } = useToast()
  const { user } = useAuth()

  const create = useMutation({
    mutationKey: shareKeys.create,
    mutationFn: (path: string) => createShareLink(path, user?.id ?? null),
  })

  const share = useCallback(
    async (path: string, title = "Check this outfit") => {
      const origin = typeof window === "undefined" ? "" : window.location.origin
      let url = `${origin}${path}`
      try {
        const slug = await create.mutateAsync(path)
        url = `${origin}/s/${slug}`
      } catch {
        // The long link still works; carry on with it.
      }

      if (typeof navigator !== "undefined" && "share" in navigator) {
        try {
          await navigator.share({ title, url })
          return
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return
          }
        }
      }

      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url)
          toast({ title: "Link copied" })
          return
        } catch {
          // Fall through.
        }
      }

      toast({ title: "Unable to copy link", description: "Please copy the URL from the address bar." })
    },
    [create, toast],
  )

  return { share, isShortening: create.isPending }
}
