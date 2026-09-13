import { useCallback, useSyncExternalStore } from 'react'

/**
 * How strongly the try-on frame is ghosted behind a segmented cutout, as a tracing guide.
 *
 * One setting for the whole admin UI: the tiles on both dashboards and the eraser's canvas read
 * the same number, so a cutout looks the same wherever you meet it. It lives outside React because
 * the slider is in a dialog while the tiles that must follow it are in the page behind — passing
 * it down would mean threading a number through every list and row.
 *
 * Persisted per browser, never sent anywhere. localStorage can be absent (SSR) or throw outright
 * (private windows, blocked site data), so every access is guarded and falls back to the default
 * rather than leaving the operator with no ghost and no explanation.
 */
export const STENCIL_OPACITY_KEY = 'atlyr.ingestion.stencilOpacity'

/** Faint enough to read as a guide rather than as content. */
export const DEFAULT_STENCIL_OPACITY = 0.12
export const STENCIL_OPACITY_MIN = 0
/** Past this the ghost starts to compete with the cutout and you lose track of what is real. */
export const STENCIL_OPACITY_MAX = 0.4

/** Out-of-range values are pulled to the nearest end; non-numbers fall back to the default. */
export function clampStencilOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_STENCIL_OPACITY
  return Math.min(STENCIL_OPACITY_MAX, Math.max(STENCIL_OPACITY_MIN, value))
}

const storage = (explicit?: Storage | null): Storage | null => {
  if (explicit !== undefined) return explicit
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function readStencilOpacity(explicit?: Storage | null): number {
  const s = storage(explicit)
  if (!s) return DEFAULT_STENCIL_OPACITY
  try {
    const raw = s.getItem(STENCIL_OPACITY_KEY)
    if (raw === null) return DEFAULT_STENCIL_OPACITY
    return clampStencilOpacity(Number(raw))
  } catch {
    return DEFAULT_STENCIL_OPACITY
  }
}

export function writeStencilOpacity(value: number, explicit?: Storage | null): void {
  const s = storage(explicit)
  if (!s) return
  try { s.setItem(STENCIL_OPACITY_KEY, String(clampStencilOpacity(value))) } catch { /* storage refused; the in-memory value still applies for this session */ }
}

// ── React binding ────────────────────────────────────────────────────────────────────────────
// A tiny store rather than context: the writer (a slider inside a dialog) and the readers (tiles
// in the page behind it) have no common ancestor worth threading a provider through.

let current = readStencilOpacity()
const listeners = new Set<() => void>()

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getSnapshot = () => current

/**
 * `[opacity, setOpacity]`, shared across every component that calls it.
 *
 * Subscribe once per list or row, NOT per tile — a grid runs to hundreds of tiles and each would
 * otherwise register its own listener for a number they all agree on.
 */
export function useStencilOpacity(): [number, (value: number) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STENCIL_OPACITY)

  const set = useCallback((next: number) => {
    const clamped = clampStencilOpacity(next)
    if (clamped === current) return
    current = clamped
    writeStencilOpacity(clamped)
    for (const fn of listeners) fn()
  }, [])

  return [value, set]
}
