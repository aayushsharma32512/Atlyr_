import { useSyncExternalStore } from "react"

/**
 * Client-side notices — the rows on Notifications that are not background jobs:
 * a piece saved, a curation that appeared, the daily try-on quota renewing.
 *
 * There is no notifications table. Each of these is derived from something the
 * client already sees happen (a save mutation succeeding, the browse query
 * returning a category it has not seen, the IST day rolling over), so the store
 * is per device and lives in localStorage. Capped so it never grows unbounded.
 */

export type NoticeKind = "save" | "curation" | "quota"

export type Notice = {
  id: string
  kind: NoticeKind
  title: string
  line: string
  /** Epoch ms. */
  at: number
  payload?: Record<string, unknown>
}

const KEY = "atlyr:notifications:notices"
const CAP = 50

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    // Private mode, blocked storage, or a non-browser runtime: behave as empty.
    return fallback
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Nothing to do if storage is unavailable; the notice still shows this session.
  }
}

let notices: Notice[] = typeof window === "undefined" ? [] : readStored<Notice[]>(KEY, [])
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot() {
  return notices
}

/** Adds a notice. Ids are stable per event, so re-emitting the same one is a no-op. */
export function addNotice(notice: Notice) {
  if (notices.some((existing) => existing.id === notice.id)) return
  notices = [notice, ...notices].slice(0, CAP)
  writeStored(KEY, notices)
  for (const listener of listeners) listener()
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** "added from hot styles" — the save's analytics section, made readable. */
export function saveLine(section?: string | null) {
  if (!section) return "added"
  return `added from ${section.replace(/[_-]+/g, " ").trim()}`
}
