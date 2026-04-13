import { createContext, useContext } from "react"

import type { EngagementEventName, Surface } from "@/integrations/posthog/engagementTracking/specTypes"

export type EngagementState = {
  sessionId: string
  isReturningDevice: boolean
  surface: Surface | null
}

export type EngagementAnalytics = {
  state: EngagementState
  capture: (name: EngagementEventName, properties?: Record<string, unknown>) => void
  identify: (distinctId: string, personProperties: Record<string, unknown>) => void
  logoutResetAndRotateSession: () => void
}

export const EngagementAnalyticsContext = createContext<EngagementAnalytics | null>(null)

export function useEngagementAnalytics(): EngagementAnalytics {
  const ctx = useContext(EngagementAnalyticsContext)
  if (!ctx) throw new Error("useEngagementAnalytics must be used within EngagementAnalyticsProvider")
  return ctx
}
