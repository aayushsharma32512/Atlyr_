import type { SlotSearchStates } from "@/features/studio/context/StudioContext"

export const SEARCH_SESSION_PREFIX = "atlyr:studio:search:"

/**
 * New on every page load, stable within one, because the module is re-evaluated
 * per document. Saved searches are stamped with it and restored only on a match,
 * so a refresh starts clean while leaving Studio and coming back keeps your
 * place. Counting mounts cannot do this — StrictMode mounts twice.
 */
export const DOCUMENT_ID = Math.random().toString(36).slice(2)

interface StoredSearch {
  d: string
  s: SlotSearchStates
}

const keyFor = (outfitId: string) => `${SEARCH_SESSION_PREFIX}${outfitId}`

/** Only committed searches are worth keeping; a half-typed draft is not. */
function committedOnly(states: SlotSearchStates): SlotSearchStates {
  const kept: SlotSearchStates = {}
  for (const [slot, state] of Object.entries(states)) {
    if (state.committedText) kept[slot] = state
  }
  return kept
}

export function readStoredSearch(outfitId: string, documentId = DOCUMENT_ID): SlotSearchStates {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.sessionStorage.getItem(keyFor(outfitId))
    if (!raw) return {}
    const stored = JSON.parse(raw) as StoredSearch
    if (stored?.d !== documentId) return {}
    const result: SlotSearchStates = {}
    for (const [slot, state] of Object.entries(stored.s ?? {})) {
      // Mirror committedText → draftText so the bar shows the restored query.
      if (state.committedText) result[slot] = { ...state, draftText: state.committedText }
    }
    return result
  } catch {
    return {}
  }
}

export function writeStoredSearch(
  outfitId: string,
  states: SlotSearchStates,
  documentId = DOCUMENT_ID,
): void {
  if (typeof window === "undefined") return
  try {
    const toSave = committedOnly(states)
    if (Object.keys(toSave).length === 0) {
      window.sessionStorage.removeItem(keyFor(outfitId))
      return
    }
    window.sessionStorage.setItem(keyFor(outfitId), JSON.stringify({ d: documentId, s: toSave }))
  } catch {
    // Quota / private-mode — ignore.
  }
}
