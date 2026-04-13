import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const SESSION_ID_KEY = "engagement:session_id"
const LAST_HIDDEN_AT_KEY = "engagement:last_hidden_at"
const HAS_VISITED_KEY = "engagement:has_visited"

const THIRTY_MINUTES_MS = 30 * 60 * 1000

function randomId(): string {
  // Avoid pulling a uuid dependency into the hot path; session_id only needs to be unique enough.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getOrCreateSessionId(): string {
  const storage = getSessionStorage()
  const existing = storage?.getItem(SESSION_ID_KEY)
  if (existing) return existing
  const created = randomId()
  storage?.setItem(SESSION_ID_KEY, created)
  return created
}

function rotateSessionId(): { prev: string; next: string } {
  const storage = getSessionStorage()
  const prev = storage?.getItem(SESSION_ID_KEY) ?? randomId()
  const next = randomId()
  storage?.setItem(SESSION_ID_KEY, next)
  return { prev, next }
}

function readLastHiddenAt(): number | null {
  const storage = getSessionStorage()
  const raw = storage?.getItem(LAST_HIDDEN_AT_KEY)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function writeLastHiddenAt(ts: number | null): void {
  const storage = getSessionStorage()
  if (!storage) return
  if (ts === null) {
    storage.removeItem(LAST_HIDDEN_AT_KEY)
    return
  }
  storage.setItem(LAST_HIDDEN_AT_KEY, String(ts))
}

function computeReturningDevice(): boolean {
  const storage = getLocalStorage()
  if (!storage) return true
  const hasVisited = storage.getItem(HAS_VISITED_KEY) === "1"
  if (!hasVisited) storage.setItem(HAS_VISITED_KEY, "1")
  return hasVisited
}

export type SessionRotation = { prevSessionId: string; nextSessionId: string } | null

export function useEngagementSession() {
  const [sessionId, setSessionId] = useState<string>(() =>
    typeof window === "undefined" ? "unknown" : getOrCreateSessionId(),
  )
  const [isReturningDevice, setIsReturningDevice] = useState<boolean>(() =>
    typeof window === "undefined" ? true : computeReturningDevice(),
  )

  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // Expose a stable getter for injection into event payloads.
  const getSessionId = useCallback(() => sessionIdRef.current, [])

  const rotate = useCallback((): SessionRotation => {
    const { prev, next } = rotateSessionId()
    setSessionId(next)
    return { prevSessionId: prev, nextSessionId: next }
  }, [])

  const onVisibilityChange = useCallback((): SessionRotation => {
    if (typeof document === "undefined") return null

    const now = Date.now()
    if (document.visibilityState === "hidden") {
      writeLastHiddenAt(now)
      return null
    }

    // Visible.
    const lastHiddenAt = readLastHiddenAt()
    writeLastHiddenAt(null)
    if (!lastHiddenAt) return null

    const hiddenForMs = now - lastHiddenAt
    if (hiddenForMs <= THIRTY_MINUTES_MS) return null

    return rotate()
  }, [rotate])

  useEffect(() => {
    // Keep returning device stable across reloads.
    setIsReturningDevice(computeReturningDevice())
  }, [])

  const api = useMemo(
    () => ({
      sessionId,
      isReturningDevice,
      getSessionId,
      rotate,
      onVisibilityChange,
    }),
    [getSessionId, isReturningDevice, onVisibilityChange, rotate, sessionId],
  )

  return api
}

