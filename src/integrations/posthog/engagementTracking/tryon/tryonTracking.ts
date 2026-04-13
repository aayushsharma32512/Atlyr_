import type { EngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { buildStudioComboKey } from "@/integrations/posthog/engagementTracking/studio/studioTracking"

const TRYON_COMBO_MAP_STORAGE_KEY = "engagement:tryon_combo_map_v1"
const TRYON_COMBO_MAP_MAX_ENTRIES = 200

type TryonComboMapEntry = { combo_key: string; ts: number }

function readTryonComboMap(): Record<string, TryonComboMapEntry> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(TRYON_COMBO_MAP_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, TryonComboMapEntry>
    if (!parsed || typeof parsed !== "object") return {}
    return parsed
  } catch {
    return {}
  }
}

function writeTryonComboMap(map: Record<string, TryonComboMapEntry>) {
  if (typeof window === "undefined") return
  try {
    const entries = Object.entries(map)
      .filter(([key, value]) => typeof key === "string" && value && typeof value.combo_key === "string" && typeof value.ts === "number")
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, TRYON_COMBO_MAP_MAX_ENTRIES)
    window.localStorage.setItem(TRYON_COMBO_MAP_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // ignore
  }
}

export function rememberTryonComboKey(tryonRequestId: string, comboKey: string) {
  if (!tryonRequestId || !comboKey) return
  const map = readTryonComboMap()
  map[tryonRequestId] = { combo_key: comboKey, ts: Date.now() }
  writeTryonComboMap(map)
}

export function getRememberedTryonComboKey(tryonRequestId: string): string | null {
  if (!tryonRequestId) return null
  const entry = readTryonComboMap()[tryonRequestId]
  if (!entry || typeof entry.combo_key !== "string") return null
  return entry.combo_key
}

export function trackTryonFlowStarted(
  analytics: EngagementAnalytics,
  input: { slotIds: { topId: string | null; bottomId: string | null; shoesId: string | null } },
) {
  const comboKey = buildStudioComboKey({
    slotIds: input.slotIds,
    hiddenSlots: { top: false, bottom: false, shoes: false },
  })

  analytics.capture("tryon_flow_started", { combo_key: comboKey })
}

export function trackTryonGenerationStarted(analytics: EngagementAnalytics, input: { tryon_request_id: string; combo_key: string }) {
  rememberTryonComboKey(input.tryon_request_id, input.combo_key)
  analytics.capture("tryon_generation_started", input)
}

export function trackTryonGenerationCompleted(
  analytics: EngagementAnalytics,
  input: { tryon_request_id: string; combo_key: string; success: boolean; duration_ms: number; error_type?: string },
) {
  analytics.capture("tryon_generation_completed", input)
}

export function trackTryonResultViewed(analytics: EngagementAnalytics, input: { tryon_request_id: string; combo_key: string }) {
  analytics.capture("tryon_result_viewed", input)
}
