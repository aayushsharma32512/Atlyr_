import { useEffect, useMemo, useRef } from "react"

import type { EngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import type { CanonicalFilter } from "@/integrations/posthog/engagementTracking/searchCanonical"
import type { Surface } from "@/integrations/posthog/engagementTracking/specTypes"

export type StudioSlot = "top" | "bottom" | "shoes"

export type StudioComboChangeType =
  | "open"
  | "swap"
  | "undo"
  | "redo"
  | "checkpoint"
  | "remix"
  | "hide_slot"
  | "restore_slot"

type StudioResultsMode = "default" | "search"

type PendingStudioComboChange = {
  change_type: StudioComboChangeType
  slot?: StudioSlot
  from_product_id?: string
  to_product_id?: string
  results_mode?: StudioResultsMode
  query_raw?: string
  filters?: CanonicalFilter[]
  sort?: string
  pendingAtMs: number
}

const PENDING_TTL_MS = 5000
let pendingComboChange: PendingStudioComboChange | null = null

export function setPendingStudioComboChange(next: Omit<PendingStudioComboChange, "pendingAtMs">) {
  pendingComboChange = { ...next, pendingAtMs: Date.now() }
}

const STUDIO_COMBO_STATE_KEY = "engagement:studio_combo_state_v1"

type StudioComboState = {
  session_id: string
  by_outfit_id: Record<string, string> // outfit_id -> last combo_key
}

function readStudioComboState(sessionId: string): StudioComboState {
  if (typeof window === "undefined") {
    return { session_id: sessionId, by_outfit_id: {} }
  }
  try {
    const raw = window.sessionStorage.getItem(STUDIO_COMBO_STATE_KEY)
    if (!raw) return { session_id: sessionId, by_outfit_id: {} }
    const parsed = JSON.parse(raw) as Partial<StudioComboState>
    if (!parsed || typeof parsed !== "object") return { session_id: sessionId, by_outfit_id: {} }
    if (parsed.session_id !== sessionId) return { session_id: sessionId, by_outfit_id: {} }
    if (!parsed.by_outfit_id || typeof parsed.by_outfit_id !== "object") {
      return { session_id: sessionId, by_outfit_id: {} }
    }
    return { session_id: sessionId, by_outfit_id: parsed.by_outfit_id as Record<string, string> }
  } catch {
    return { session_id: sessionId, by_outfit_id: {} }
  }
}

function writeStudioComboState(state: StudioComboState) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(STUDIO_COMBO_STATE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

function getLastComboKeyForOutfit(sessionId: string, outfitId: string): string | null {
  const state = readStudioComboState(sessionId)
  return state.by_outfit_id[outfitId] ?? null
}

function setLastComboKeyForOutfit(sessionId: string, outfitId: string, comboKey: string) {
  const state = readStudioComboState(sessionId)
  state.by_outfit_id[outfitId] = comboKey
  writeStudioComboState(state)
}

function consumePendingStudioComboChange(): Omit<PendingStudioComboChange, "pendingAtMs"> | null {
  const current = pendingComboChange
  pendingComboChange = null
  if (!current) return null
  if (Date.now() - current.pendingAtMs > PENDING_TTL_MS) return null
  const { pendingAtMs: _pendingAtMs, ...rest } = current
  return rest
}

export function buildStudioComboKey(input: {
  slotIds: { topId: string | null; bottomId: string | null; shoesId: string | null }
  hiddenSlots: { top: boolean; bottom: boolean; shoes: boolean }
}): string {
  const top = input.hiddenSlots.top ? null : input.slotIds.topId
  const bottom = input.hiddenSlots.bottom ? null : input.slotIds.bottomId
  const shoes = input.hiddenSlots.shoes ? null : input.slotIds.shoesId
  return `top:${top ?? "null"}|bottom:${bottom ?? "null"}|shoes:${shoes ?? "null"}`
}

export function trackStudioProductViewed(analytics: EngagementAnalytics, productId: string) {
  analytics.capture("studio_product_viewed", { entity_type: "product", entity_id: productId })
}

function isStudioSessionSurface(surface: Surface | null): surface is Extract<
  Surface,
  "studio_main" | "studio_alternatives" | "studio_scroll_up" | "studio_likeness"
> {
  return (
    surface === "studio_main" ||
    surface === "studio_alternatives" ||
    surface === "studio_scroll_up" ||
    surface === "studio_likeness"
  )
}

export function useStudioCombinationTracking(input: {
  analytics: EngagementAnalytics
  surface: Surface | null
  outfitId: string | null
  slotIds: { topId: string | null; bottomId: string | null; shoesId: string | null }
  hiddenSlots: { top: boolean; bottom: boolean; shoes: boolean }
}) {
  const comboKey = useMemo(
    () =>
      buildStudioComboKey({
        slotIds: {
          topId: input.slotIds.topId,
          bottomId: input.slotIds.bottomId,
          shoesId: input.slotIds.shoesId,
        },
        hiddenSlots: {
          top: input.hiddenSlots.top,
          bottom: input.hiddenSlots.bottom,
          shoes: input.hiddenSlots.shoes,
        },
      }),
    [
      input.hiddenSlots.bottom,
      input.hiddenSlots.shoes,
      input.hiddenSlots.top,
      input.slotIds.bottomId,
      input.slotIds.shoesId,
      input.slotIds.topId,
    ],
  )

  const lastEmitSigRef = useRef<{ sig: string; ts: number } | null>(null)

  useEffect(() => {
    if (!isStudioSessionSurface(input.surface)) return
    if (!input.outfitId) return
    const sessionId = input.analytics.state.sessionId

    const lastComboKey = getLastComboKeyForOutfit(sessionId, input.outfitId)
    if (lastComboKey === comboKey) return

    const pending = consumePendingStudioComboChange()
    const isFirstCombo = lastComboKey === null

    // If we can't attribute a change_type for non-initial changes, skip rather than mislabel.
    if (!isFirstCombo && !pending) {
      setLastComboKeyForOutfit(sessionId, input.outfitId, comboKey)
      return
    }

    const payload: Record<string, unknown> = {
      outfit_id: input.outfitId,
      combo_key: comboKey,
      change_type: pending?.change_type ?? ("open" as const),
    }

    if (pending?.slot) payload.slot = pending.slot
    if (pending?.from_product_id) payload.from_product_id = pending.from_product_id
    if (pending?.to_product_id) payload.to_product_id = pending.to_product_id

    if (pending?.results_mode) payload.results_mode = pending.results_mode
    if (pending?.results_mode === "search") {
      if (typeof pending.query_raw === "string") payload.query_raw = pending.query_raw
      if (Array.isArray(pending.filters)) payload.filters = pending.filters
      if (typeof pending.sort === "string") payload.sort = pending.sort
    }

    // DEV-only short-window dedupe to prevent accidental double-fires from rerenders.
    if (import.meta.env.DEV) {
      const sig = `${input.surface}:${payload.outfit_id}:${payload.combo_key}:${payload.change_type}:${payload.slot ?? ""}:${payload.from_product_id ?? ""}:${payload.to_product_id ?? ""}`
      const last = lastEmitSigRef.current
      if (last && last.sig === sig && Date.now() - last.ts < 1000) {
        setLastComboKeyForOutfit(sessionId, input.outfitId, comboKey)
        return
      }
      lastEmitSigRef.current = { sig, ts: Date.now() }
    }

    input.analytics.capture("studio_combination_viewed", payload)
    setLastComboKeyForOutfit(sessionId, input.outfitId, comboKey)
  }, [comboKey, input.analytics, input.outfitId, input.surface])
}
