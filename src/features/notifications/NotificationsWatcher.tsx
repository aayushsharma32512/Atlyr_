import { useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { ToastAction } from "@/components/ui/toast"
import { useAuth } from "@/contexts/AuthContext"
import { useSearchBrowseCollections } from "@/features/search/hooks/useSearchBrowseCollections"
import { useToast } from "@/hooks/use-toast"
import { checkTryOnLimit } from "@/services/tryon/tryonService"

import { useUserNotifications } from "./hooks/useUserNotifications"
import { addNotice, readStored, writeStored } from "./notices"

const SEEN_CURATIONS_KEY = "atlyr:notifications:seenCurations"
const TRYON_DAY_KEY = "atlyr:notifications:tryonDay"
/** A curation older than this is not "new", whatever this device has seen. */
const FRESH_MS = 30 * 24 * 60 * 60 * 1000
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** Calendar day in IST — the try-on quota resets at 12 AM IST (tryonService). */
function istDay(now = Date.now()) {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10)
}

function istMidnightMs(day: string) {
  return Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS
}

/**
 * "New Atlyr curation": a category this device has not seen before, created in
 * the last 30 days. The first run only records what exists — otherwise every
 * curation would arrive as "new" on day one.
 */
function useCurationNotices(enabled: boolean) {
  const browse = useSearchBrowseCollections({ enabled })

  useEffect(() => {
    const collections = browse.data
    if (!collections) return

    const ids = collections.map((collection) => collection.categoryId)
    const seen = readStored<string[] | null>(SEEN_CURATIONS_KEY, null)
    if (seen === null) {
      writeStored(SEEN_CURATIONS_KEY, ids)
      return
    }

    const seenSet = new Set(seen)
    const now = Date.now()
    for (const collection of collections) {
      if (seenSet.has(collection.categoryId)) continue
      const at = collection.createdAt ? Date.parse(collection.createdAt) : Number.NaN
      if (!Number.isFinite(at) || now - at > FRESH_MS) continue
      const count = collection.outfits.length
      addNotice({
        id: `curation:${collection.categoryId}`,
        kind: "curation",
        title: "New Atlyr curation",
        line: `${collection.title} — ${count} ${count === 1 ? "look" : "looks"} picked for you`,
        at,
        payload: { categoryId: collection.categoryId },
      })
    }
    writeStored(SEEN_CURATIONS_KEY, Array.from(new Set([...seen, ...ids])))
  }, [browse.data])
}

/**
 * "Try-on quota renewed": the first look at a new IST day, when the previous
 * day had usage. Nobody who never tries on gets pinged every morning.
 */
function useQuotaRenewalNotice(enabled: boolean) {
  const limits = useQuery({
    queryKey: ["daily-limits", "tryon-watch"],
    queryFn: () => checkTryOnLimit(),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    const tryon = limits.data
    if (!tryon) return

    const today = istDay()
    const stored = readStored<{ day: string; used: number } | null>(TRYON_DAY_KEY, null)
    if (stored && stored.day !== today && stored.used > 0) {
      const left = Math.max(0, tryon.limit - tryon.count)
      addNotice({
        id: `quota:${today}`,
        kind: "quota",
        title: "Try-on quota renewed",
        line: `${left} of ${tryon.limit} try-ons left today`,
        at: istMidnightMs(today),
      })
    }
    writeStored(TRYON_DAY_KEY, { day: today, used: tryon.count })
  }, [limits.data])
}

/**
 * Toasts a server notification the moment it arrives. The first poll only
 * records what is already unread — a returning user would otherwise be toasted
 * for a backlog they have not opened yet.
 */
function useServerNotificationToasts() {
  const notifications = useUserNotifications()
  const { toast } = useToast()
  const navigate = useNavigate()
  const seenIds = useRef<Set<string> | null>(null)

  useEffect(() => {
    const unread = (notifications.data ?? []).filter((notification) => notification.readAt === null)
    if (!notifications.data) return
    if (seenIds.current === null) {
      seenIds.current = new Set(unread.map((notification) => notification.id))
      return
    }
    for (const notification of unread) {
      if (seenIds.current.has(notification.id)) continue
      seenIds.current.add(notification.id)
      const href = notification.href
      toast({
        title: notification.title,
        description: notification.body ?? undefined,
        action: href ? (
          <ToastAction altText="View" onClick={() => navigate(href)}>
            View
          </ToastAction>
        ) : undefined,
      })
    }
  }, [navigate, notifications.data, toast])
}

/**
 * Mounted once, inside JobsProvider. Renders nothing; it only watches for the
 * notices that come from data rather than from a user action. All are gated on
 * a signed-in user — checkTryOnLimit would otherwise sign a visitor in
 * anonymously just to read a count.
 */
export function NotificationsWatcher() {
  const { user } = useAuth()
  const enabled = Boolean(user)
  useCurationNotices(enabled)
  useQuotaRenewalNotice(enabled)
  useServerNotificationToasts()
  return null
}
