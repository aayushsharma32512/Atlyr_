import type { EngagementEventName } from "./specTypes"

export type DebugEventRecord = {
  name: EngagementEventName
  properties: Record<string, unknown>
  ts: number
}

const MAX_EVENTS = 500

declare global {
  interface Window {
    __atlyrEngagementDebugEvents?: DebugEventRecord[]
  }
}

export function recordEngagementDebugEvent(evt: DebugEventRecord): void {
  if (!import.meta.env.DEV) return
  if (typeof window === "undefined") return

  const buf = (window.__atlyrEngagementDebugEvents ??= [])
  buf.push(evt)
  if (buf.length > MAX_EVENTS) {
    buf.splice(0, buf.length - MAX_EVENTS)
  }
}

