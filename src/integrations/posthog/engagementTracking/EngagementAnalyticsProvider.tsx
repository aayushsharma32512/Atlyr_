import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { usePostHog } from "posthog-js/react"

import { isPostHogAllowedPath, shouldDisablePostHogForLocation } from "@/integrations/posthog/posthogRoutePolicy"
import { recordEngagementDebugEvent } from "@/integrations/posthog/engagementTracking/analyticsDebug"
import { useActiveTimeAccumulator } from "@/integrations/posthog/engagementTracking/activeTime"
import { EngagementAnalyticsContext, type EngagementAnalytics, type EngagementState } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import {
  flushSearchResultsBrowseDepth,
  hardResetSearchResultsBrowseDepth,
  softResetSearchResultsBrowseDepth,
} from "@/integrations/posthog/engagementTracking/browseDepth/searchResultsBrowseDepth"
import {
  flushHomeBrowseDepth,
  hardResetHomeBrowseDepth,
  softResetHomeBrowseDepth,
} from "@/integrations/posthog/engagementTracking/browseDepth/homeBrowseDepth"
import { useEngagementSession } from "@/integrations/posthog/engagementTracking/session"
import { computeSurfaceContext } from "@/integrations/posthog/engagementTracking/surface"
import type { Surface } from "@/integrations/posthog/engagementTracking/specTypes"

function nowMs(): number {
  return Date.now()
}

function getReferrer(): string {
  if (typeof document === "undefined") return ""
  return document.referrer ?? ""
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

const ENTITY_EVENT_NAMES = new Set([
  "item_clicked",
  "save_toggled",
  "saved_to_collection",
  "product_buy_clicked",
])

export function EngagementAnalyticsProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const posthog = usePostHog()
  const session = useEngagementSession()
  const activeTime = useActiveTimeAccumulator()

  const hostname = typeof window === "undefined" ? "" : window.location.hostname
  const pathname = location.pathname

  const isInScopePath = isPostHogAllowedPath(pathname)
  const sendingDisabled = shouldDisablePostHogForLocation({ hostname, pathname })

  const surfaceContext = useMemo(() => {
    if (!isInScopePath) return { surface: null as Surface | null, props: {} as Record<string, unknown> }
    return computeSurfaceContext({
      pathname,
      search: location.search,
      isReturningDevice: session.isReturningDevice,
      referrer: getReferrer(),
    })
  }, [isInScopePath, location.search, pathname, session.isReturningDevice])

  const state: EngagementState = useMemo(
    () => ({
      sessionId: session.sessionId,
      isReturningDevice: session.isReturningDevice,
      surface: surfaceContext.surface,
    }),
    [session.isReturningDevice, session.sessionId, surfaceContext.surface],
  )

  const shouldSendToPostHog = useCallback(() => {
    if (!posthog) return false
    if (sendingDisabled) return false
    return true
  }, [posthog, sendingDisabled])

  const capture = useCallback<EngagementAnalytics["capture"]>(
    (name, properties = {}) => {
      const surface = surfaceContext.surface
      if (!surface) return

      const payload = {
        session_id: session.getSessionId(),
        surface,
        ...properties,
      }

      recordEngagementDebugEvent({ name, properties: payload, ts: nowMs() })

      if (!shouldSendToPostHog()) return
      posthog?.capture(name, payload)
    },
    [posthog, session, shouldSendToPostHog, surfaceContext.surface],
  )

  const lastSurfaceRef = useRef<Surface | null>(null)
  const prevSurfaceRef = useRef<Surface | null>(null)
  const hasSearchSubmittedSinceSurfaceEnterRef = useRef(false)
  const hadSearchSubmitBeforeSearchSurfaceEnterRef = useRef(false)
  const currentSearchContextRef = useRef<{ searchId: string; mode: string } | null>(null)
  const lastScreenEnteredSigRef = useRef<{ sig: string; ts: number } | null>(null)
  const lastScreenDurationSigRef = useRef<{ sig: string; ts: number } | null>(null)
  const lastMoodboardSlugRef = useRef<string | null>(null)
  const lastSurfaceForMoodboardSelectedRef = useRef<Surface | null>(null)
  const lastMoodboardSelectedSigRef = useRef<{ sig: string; ts: number } | null>(null)
  const landingAttributionRef = useRef<Record<string, unknown> | null>(null)
  const homeBrowseMoodboardSlugRef = useRef<string | null>(null)

  const LANDING_ATTR_STORAGE_KEY = "engagement:last_landing_attribution_v1"

  const readLandingAttribution = useCallback((): Record<string, unknown> | null => {
    if (landingAttributionRef.current) return landingAttributionRef.current
    try {
      const raw = window.sessionStorage.getItem(LANDING_ATTR_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (!parsed || typeof parsed !== "object") return null
      landingAttributionRef.current = parsed
      return parsed
    } catch {
      return null
    }
  }, [])

  const writeLandingAttribution = useCallback((props: Record<string, unknown>) => {
    landingAttributionRef.current = props
    try {
      window.sessionStorage.setItem(LANDING_ATTR_STORAGE_KEY, JSON.stringify(props))
    } catch {
      // ignore
    }
  }, [])

  const flushPendingSummaries = useCallback(
    (reason: string) => {
      const currentSurface = lastSurfaceRef.current
      if (!currentSurface) return

      if (currentSurface === "search_results") {
        const searchCtx = currentSearchContextRef.current
        const summary = flushSearchResultsBrowseDepth()

        if (summary && searchCtx) {
          const payload = {
            session_id: session.getSessionId(),
            surface: "search_results" as const,
            container_type: "screen" as const,
            layout: "vertical_grid" as const,
            max_position_seen: summary.maxPositionSeen,
            unique_items_seen_count: summary.uniqueItemsSeenCount,
            search_id: searchCtx.searchId,
            mode: searchCtx.mode,
          }

          recordEngagementDebugEvent({ name: "items_seen_summary", properties: payload, ts: nowMs() })
          if (shouldSendToPostHog()) posthog?.capture("items_seen_summary", payload)
        }

        if (reason === "session_rotation" || reason === "search_reset") {
          softResetSearchResultsBrowseDepth()
        } else {
          hardResetSearchResultsBrowseDepth()
        }
      }

      if (currentSurface === "home_moodboard") {
        const moodboardSlugFromRef = homeBrowseMoodboardSlugRef.current
        const moodboardSlugFromSurface = (surfaceContext.props as Record<string, unknown>).moodboard_slug
        const moodboardSlug = isNonEmptyString(moodboardSlugFromRef)
          ? moodboardSlugFromRef
          : isNonEmptyString(moodboardSlugFromSurface)
            ? moodboardSlugFromSurface
            : null

        const summaries = flushHomeBrowseDepth()

        for (const summary of summaries) {
          const basePayload: Record<string, unknown> = {
            session_id: session.getSessionId(),
            surface: "home_moodboard",
            max_position_seen: summary.maxPositionSeen,
            unique_items_seen_count: summary.uniqueItemsSeenCount,
          }

          if (moodboardSlug) basePayload.moodboard_slug = moodboardSlug

          if (summary.containerKey === "curated_grid") {
            basePayload.container_type = "screen"
            basePayload.container_id = "home_curated"
            basePayload.layout = "vertical_grid"
            basePayload.section = "curated"
          } else if (summary.containerKey === "moodboard_items") {
            basePayload.container_type = "screen"
            basePayload.container_id = "home_moodboard_items"
            basePayload.layout = "vertical_grid"
          } else if (summary.containerKey === "tryons_grid") {
            basePayload.container_type = "screen"
            basePayload.container_id = "home_tryons"
            basePayload.layout = "vertical_grid"
          } else if (summary.containerKey === "recent_styles_rail") {
            basePayload.container_type = "rail"
            basePayload.layout = "horizontal_rail"
            basePayload.section = "recent"
            if (summary.railId) basePayload.rail_id = summary.railId
          }

          recordEngagementDebugEvent({ name: "items_seen_summary", properties: basePayload, ts: nowMs() })
          if (shouldSendToPostHog()) posthog?.capture("items_seen_summary", basePayload)
        }

        if (reason === "session_rotation" || reason === "moodboard_change") {
          softResetHomeBrowseDepth()
        } else {
          hardResetHomeBrowseDepth()
        }
      }
    },
    [posthog, session, shouldSendToPostHog, surfaceContext.props],
  )

  const emitScreenEntered = useCallback(
    (opts: {
      sessionId: string
      surface: Surface
      entrySurface: Surface | "unknown"
      extraProps?: Record<string, unknown>
    }) => {
      const { sessionId, surface, entrySurface, extraProps = {} } = opts

      const payload = {
        session_id: sessionId,
        surface,
        entry_surface: entrySurface,
        ...extraProps,
      }

      if (import.meta.env.DEV) {
        const sig = `${payload.session_id}:${payload.surface}:${payload.entry_surface}`
        const last = lastScreenEnteredSigRef.current
        if (last && last.sig === sig && nowMs() - last.ts < 1000) return
        lastScreenEnteredSigRef.current = { sig, ts: nowMs() }
      }

      recordEngagementDebugEvent({ name: "screen_entered", properties: payload, ts: nowMs() })
      if (!shouldSendToPostHog()) return
      posthog?.capture("screen_entered", payload)
    },
    [posthog, shouldSendToPostHog],
  )

  const emitScreenDuration = useCallback(
    (opts: { sessionId: string; surface: Surface; activeDurationMs: number }) => {
      const payload = {
        session_id: opts.sessionId,
        surface: opts.surface,
        active_duration_ms: opts.activeDurationMs,
      }

      if (import.meta.env.DEV) {
        const sig = `${payload.session_id}:${payload.surface}:${payload.active_duration_ms}`
        const last = lastScreenDurationSigRef.current
        if (last && last.sig === sig && nowMs() - last.ts < 1000) return
        lastScreenDurationSigRef.current = { sig, ts: nowMs() }
      }

      recordEngagementDebugEvent({ name: "screen_duration", properties: payload, ts: nowMs() })
      if (!shouldSendToPostHog()) return
      posthog?.capture("screen_duration", payload)
    },
    [posthog, shouldSendToPostHog],
  )

  // Visibility tracking + session rotation (>30m hidden).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        activeTime.pause()
        session.onVisibilityChange()
        return
      }

      const rotation = session.onVisibilityChange()
      if (rotation && lastSurfaceRef.current) {
        flushPendingSummaries("session_rotation")
        emitScreenDuration({
          sessionId: rotation.prevSessionId,
          surface: lastSurfaceRef.current,
          activeDurationMs: activeTime.getActiveDurationMs(),
        })

        currentSearchContextRef.current = null
        activeTime.reset()
        emitScreenEntered({
          sessionId: rotation.nextSessionId,
          surface: lastSurfaceRef.current,
          entrySurface: "unknown",
          extraProps: surfaceContext.props,
        })

        return
      }

      activeTime.resume()
    }

    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [
    activeTime,
    emitScreenDuration,
    emitScreenEntered,
    flushPendingSummaries,
    session,
    surfaceContext.props,
  ])

  // `pagehide` flush + duration.
  useEffect(() => {
    const onPageHide = () => {
      if (!lastSurfaceRef.current) return
      flushPendingSummaries("pagehide")
      emitScreenDuration({
        sessionId: session.getSessionId(),
        surface: lastSurfaceRef.current,
        activeDurationMs: activeTime.getActiveDurationMs(),
      })
    }

    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [activeTime, emitScreenDuration, flushPendingSummaries, session])

  // Surface transitions drive screen_entered / screen_duration.
  useEffect(() => {
    const nextSurface = surfaceContext.surface
    const prevSurface = lastSurfaceRef.current

    if (prevSurface !== nextSurface) {
      prevSurfaceRef.current = prevSurface
      const preserveSearchSubmitted = nextSurface === "search_results" && hadSearchSubmitBeforeSearchSurfaceEnterRef.current
      hasSearchSubmittedSinceSurfaceEnterRef.current = preserveSearchSubmitted
      if (nextSurface === "search_results") {
        hadSearchSubmitBeforeSearchSurfaceEnterRef.current = false
      }
    }

    if (prevSurface && prevSurface !== nextSurface) {
      flushPendingSummaries("surface_exit")
      emitScreenDuration({
        sessionId: session.getSessionId(),
        surface: prevSurface,
        activeDurationMs: activeTime.getActiveDurationMs(),
      })
    }

    if (!nextSurface) {
      lastSurfaceRef.current = null
      activeTime.reset()
      return
    }

    if (prevSurface !== nextSurface) {
      const entrySurface = prevSurface ? prevSurface : "unknown"

      activeTime.reset()
      emitScreenEntered({
        sessionId: session.getSessionId(),
        surface: nextSurface,
        entrySurface,
        extraProps: surfaceContext.props,
      })

      if (nextSurface === "home_moodboard") {
        const moodboardSlug = (surfaceContext.props as Record<string, unknown>).moodboard_slug
        homeBrowseMoodboardSlugRef.current = isNonEmptyString(moodboardSlug) ? moodboardSlug : null
      }

      if (nextSurface === "landing") {
        // Store the most recent landing attribution within the session for reuse (e.g. waitlist_submitted).
        writeLandingAttribution(surfaceContext.props)
      }
    }

    lastSurfaceRef.current = nextSurface
  }, [activeTime, emitScreenDuration, emitScreenEntered, flushPendingSummaries, session, surfaceContext, writeLandingAttribution])

  const identify = useCallback<EngagementAnalytics["identify"]>(
    (distinctId, personProperties) => {
      if (!shouldSendToPostHog()) return
      posthog?.identify(distinctId, personProperties)
    },
    [posthog, shouldSendToPostHog],
  )

  const logoutResetAndRotateSession = useCallback<EngagementAnalytics["logoutResetAndRotateSession"]>(() => {
    const currentSurface = lastSurfaceRef.current
    if (!currentSurface) {
      if (shouldSendToPostHog()) posthog?.reset()
      currentSearchContextRef.current = null
      session.rotate()
      activeTime.reset()
      return
    }

    // Session rotation anchor (logout): end the current session, reset identity, then start a new session on the same surface.
    flushPendingSummaries("logout")
    emitScreenDuration({
      sessionId: session.getSessionId(),
      surface: currentSurface,
      activeDurationMs: activeTime.getActiveDurationMs(),
    })

    if (shouldSendToPostHog()) posthog?.reset()
    currentSearchContextRef.current = null

    const rotation = session.rotate()
    if (!rotation) return

    activeTime.reset()
    emitScreenEntered({
      sessionId: rotation.nextSessionId,
      surface: currentSurface,
      entrySurface: "unknown",
      extraProps: surfaceContext.props,
    })
  }, [
    activeTime,
    emitScreenDuration,
    emitScreenEntered,
    flushPendingSummaries,
    posthog,
    session,
    shouldSendToPostHog,
    surfaceContext.props,
  ])

  const captureWithSpecInjection = useCallback<EngagementAnalytics["capture"]>(
    (name, properties = {}) => {
      const currentSurface = surfaceContext.surface

      if (name === "waitlist_submitted") {
        const landingProps = readLandingAttribution()
        const merged = { ...(landingProps ?? {}), ...properties }
        capture(name, merged)
        return
      }

      // Try-on lifecycle events must be attributed to `surface=studio_likeness` per spec.
      if (
        name === "tryon_generation_started" ||
        name === "tryon_generation_completed" ||
        name === "tryon_result_viewed"
      ) {
        capture(name, { ...properties, surface: "studio_likeness" })
        return
      }

      // Canonical context injection for entity events.
      if (ENTITY_EVENT_NAMES.has(name)) {
        const merged: Record<string, unknown> = { ...properties }

        // Home moodboard identity is represented by `moodboard_slug` (never by `section`).
        if (currentSurface === "home_moodboard") {
          const moodboardSlug = (surfaceContext.props as Record<string, unknown>).moodboard_slug
          if (isNonEmptyString(moodboardSlug) && !isNonEmptyString(merged.moodboard_slug)) {
            merged.moodboard_slug = moodboardSlug
          }
        }

        // Search entity events must include the active `{search_id, mode}`.
        if (currentSurface === "search_results") {
          const ctx = currentSearchContextRef.current
          if (ctx) {
            if (!isNonEmptyString(merged.search_id)) merged.search_id = ctx.searchId
            if (!isNonEmptyString(merged.mode)) merged.mode = ctx.mode
          }
        }

        capture(name, merged)
        return
      }

      if (name === "search_submitted") {
        // `entry_surface` is emitted only on screen_entered + search_submitted.
        // Rule: first search submitted after entering search_results uses the prior surface; subsequent ones use search_results.
        if (currentSurface !== "search_results") {
          // Persist the active search context even if the first submit happens before the route effect has
          // recorded the search surface entry. Entity events on search_results still need `{search_id, mode}`.
          const searchId = (properties as Record<string, unknown>).search_id
          const mode = (properties as Record<string, unknown>).mode
          if (isNonEmptyString(searchId) && isNonEmptyString(mode)) {
            currentSearchContextRef.current = { searchId, mode }
          }

          capture(name, properties)
          return
        }

        let entrySurface: Surface | "unknown" = "unknown"
        const lastSurface = lastSurfaceRef.current

        // If we haven't recorded the search surface enter yet (effect ordering), lastSurface can still be the prior surface.
        if (lastSurface && lastSurface !== "search_results") {
          entrySurface = lastSurface
          hadSearchSubmitBeforeSearchSurfaceEnterRef.current = true
        } else if (hasSearchSubmittedSinceSurfaceEnterRef.current) {
          entrySurface = "search_results"
        } else if (prevSurfaceRef.current) {
          entrySurface = prevSurfaceRef.current
        }

        const nextSearchId = (properties as Record<string, unknown>).search_id
        if (isNonEmptyString(nextSearchId) && currentSearchContextRef.current?.searchId !== nextSearchId) {
          // New search results set while staying on the same surface: flush summaries for the old search_id before reset.
          flushPendingSummaries("search_reset")
        }

        hasSearchSubmittedSinceSurfaceEnterRef.current = true

        const merged = { ...properties, entry_surface: entrySurface }

        // Persist the active search context for downstream entity events on search_results.
        const searchId = (properties as Record<string, unknown>).search_id
        const mode = (properties as Record<string, unknown>).mode
        if (isNonEmptyString(searchId) && isNonEmptyString(mode)) {
          // Ensure browse depth starts fresh for each results set without requiring ref re-registration.
          softResetSearchResultsBrowseDepth()
          currentSearchContextRef.current = { searchId, mode }
        }

        capture(name, merged)
        return
      }

      capture(name, properties)
    },
    [capture, flushPendingSummaries, readLandingAttribution, surfaceContext.props, surfaceContext.surface],
  )

  // Home moodboard/tab changes should emit `moodboard_selected` even when the surface remains `home_moodboard`.
  useEffect(() => {
    const currentSurface = surfaceContext.surface
    if (currentSurface !== "home_moodboard") {
      lastSurfaceForMoodboardSelectedRef.current = currentSurface
      lastMoodboardSlugRef.current = null
      return
    }

    const moodboardSlug = (surfaceContext.props as Record<string, unknown>).moodboard_slug
    if (!isNonEmptyString(moodboardSlug)) return

    // M1-B: emit only for tab switches *within* Home (not on initial entry or re-entry from another surface).
    const wasAlreadyOnHomeMoodboard = lastSurfaceForMoodboardSelectedRef.current === "home_moodboard"
    lastSurfaceForMoodboardSelectedRef.current = "home_moodboard"
    if (!wasAlreadyOnHomeMoodboard) {
      lastMoodboardSlugRef.current = moodboardSlug
      homeBrowseMoodboardSlugRef.current = moodboardSlug
      return
    }

    if (lastMoodboardSlugRef.current === moodboardSlug) return

    // Dataset changed while staying on `surface=home_moodboard`: flush & reset browse depth before switching.
    flushPendingSummaries("moodboard_change")

    lastMoodboardSlugRef.current = moodboardSlug
    homeBrowseMoodboardSlugRef.current = moodboardSlug

    if (import.meta.env.DEV) {
      const sig = `${session.getSessionId()}:${currentSurface}:${moodboardSlug}`
      const last = lastMoodboardSelectedSigRef.current
      if (last && last.sig === sig && nowMs() - last.ts < 1000) return
      lastMoodboardSelectedSigRef.current = { sig, ts: nowMs() }
    }

    captureWithSpecInjection("moodboard_selected", { moodboard_slug: moodboardSlug })
  }, [captureWithSpecInjection, flushPendingSummaries, session, surfaceContext.props, surfaceContext.surface])

  const ctxValue = useMemo<EngagementAnalytics>(
    () => ({ state, capture: captureWithSpecInjection, identify, logoutResetAndRotateSession }),
    [captureWithSpecInjection, identify, logoutResetAndRotateSession, state],
  )

  return <EngagementAnalyticsContext.Provider value={ctxValue}>{children}</EngagementAnalyticsContext.Provider>
}
