import type { SlotIdMap } from "@/features/studio/utils/studioUrlState"
import type { StudioProductTraySlot } from "@/services/studio/studioService"

export const MAX_HISTORY = 7

// v2 drops the `checkpointDirty` rewrite, which used to let an edited look
// redefine itself as "the original". Stored v1 states carry a poisoned anchor,
// so the bumped version deliberately abandons them.
const HISTORY_STORAGE_VERSION = "v2"
const HISTORY_STORAGE_PREFIX = "studio-history"

/** Where a user's studio undo stack + restore anchor live, across the studio's routes. */
export function studioHistoryStorageKey(userId: string | null | undefined): string {
  return `${HISTORY_STORAGE_PREFIX}-${HISTORY_STORAGE_VERSION}:${userId ?? "anon"}:session`
}

export type NormalizedSlotIds = {
  top: string | null
  bottom: string | null
  shoes: string | null
}

export type HiddenSlotMap = {
  top: boolean
  bottom: boolean
  shoes: boolean
}

export type StudioHistorySnapshot = {
  outfitId: string | null
  slotIds: NormalizedSlotIds
  hiddenSlots: HiddenSlotMap
}

export type StudioHistoryState = {
  past: StudioHistorySnapshot[]
  present: StudioHistorySnapshot | null
  future: StudioHistorySnapshot[]
  /**
   * The look the studio was opened with. This is the anchor the restore button
   * returns to, and nothing but opening a different outfit ever moves it — a
   * user who tries ten combinations and likes none of them gets back exactly
   * what they clicked from home.
   */
  checkpointSnapshot: StudioHistorySnapshot | null
  checkpointActive: boolean
  /** The edits parked while sitting on the anchor, so one more press comes back to them. */
  preCheckpointHistory: {
    past: StudioHistorySnapshot[]
    present: StudioHistorySnapshot | null
    future: StudioHistorySnapshot[]
  } | null
}

type Applied = {
  state: StudioHistoryState
  snapshotToApply: StudioHistorySnapshot | null
}

export function normalizeSlotIds(slotIds: SlotIdMap = {}): NormalizedSlotIds {
  return {
    top: slotIds.top ?? null,
    bottom: slotIds.bottom ?? null,
    shoes: slotIds.shoes ?? null,
  }
}

export function normalizeHiddenSlots(
  hiddenSlots?: Partial<Record<StudioProductTraySlot, boolean>>,
): HiddenSlotMap {
  return {
    top: Boolean(hiddenSlots?.top),
    bottom: Boolean(hiddenSlots?.bottom),
    shoes: Boolean(hiddenSlots?.shoes),
  }
}

export function normalizeSnapshot(snapshot: StudioHistorySnapshot | null): StudioHistorySnapshot | null {
  if (!snapshot) {
    return null
  }
  return {
    outfitId: snapshot.outfitId ?? null,
    slotIds: normalizeSlotIds(snapshot.slotIds ?? {}),
    hiddenSlots: normalizeHiddenSlots(snapshot.hiddenSlots),
  }
}

export function normalizeHistoryState(state: StudioHistoryState): StudioHistoryState {
  const normalizeList = (list: StudioHistorySnapshot[] = []) =>
    list.map((entry) => normalizeSnapshot(entry)).filter(Boolean) as StudioHistorySnapshot[]

  return {
    past: normalizeList(state.past),
    present: normalizeSnapshot(state.present),
    future: normalizeList(state.future),
    checkpointSnapshot: normalizeSnapshot(state.checkpointSnapshot),
    checkpointActive: Boolean(state.checkpointActive),
    preCheckpointHistory: state.preCheckpointHistory
      ? {
          past: normalizeList(state.preCheckpointHistory.past),
          present: normalizeSnapshot(state.preCheckpointHistory.present),
          future: normalizeList(state.preCheckpointHistory.future),
        }
      : null,
  }
}

export function snapshotsEqual(a: StudioHistorySnapshot | null, b: StudioHistorySnapshot | null): boolean {
  if (!a || !b) {
    return false
  }
  return (
    a.outfitId === b.outfitId &&
    a.slotIds.top === b.slotIds.top &&
    a.slotIds.bottom === b.slotIds.bottom &&
    a.slotIds.shoes === b.slotIds.shoes &&
    a.hiddenSlots.top === b.hiddenSlots.top &&
    a.hiddenSlots.bottom === b.hiddenSlots.bottom &&
    a.hiddenSlots.shoes === b.hiddenSlots.shoes
  )
}

export function hasAnySlotId(snapshot: StudioHistorySnapshot | null): boolean {
  return Boolean(snapshot && (snapshot.slotIds.top || snapshot.slotIds.bottom || snapshot.slotIds.shoes))
}

/** A fresh stack anchored on the look the studio just opened. */
export function anchoredState(snapshot: StudioHistorySnapshot): StudioHistoryState {
  const normalized = normalizeSnapshot(snapshot) as StudioHistorySnapshot
  return {
    past: [],
    present: normalized,
    future: [],
    checkpointSnapshot: normalized,
    checkpointActive: false,
    preCheckpointHistory: null,
  }
}

/**
 * A stack written from outside the studio, so the studio hydrates with undo
 * already loaded — the product page uses this to make "open in studio" undoable
 * back to the look you came from. The anchor is the look being opened, same as
 * `anchoredState`; the past is only there for undo.
 */
export function seededState(
  present: StudioHistorySnapshot,
  past: StudioHistorySnapshot[] = [],
): StudioHistoryState {
  const normalized = normalizeSnapshot(present) as StudioHistorySnapshot
  return {
    past: (past.map((entry) => normalizeSnapshot(entry)).filter(Boolean) as StudioHistorySnapshot[]).slice(
      -MAX_HISTORY,
    ),
    present: normalized,
    future: [],
    checkpointSnapshot: normalized,
    checkpointActive: false,
    preCheckpointHistory: null,
  }
}

/**
 * The anchor is taken the moment an outfit id appears, which on a cold start is
 * a tick before the slot ids are synced into the URL. Fill those in once, and
 * only while nothing has been edited, so a real change can never be mistaken
 * for the missing half of the landing state.
 */
export function upgradeAnchorState(
  state: StudioHistoryState,
  snapshot: StudioHistorySnapshot,
): StudioHistoryState {
  const anchor = state.checkpointSnapshot
  if (!anchor || hasAnySlotId(anchor)) {
    return state
  }
  if (state.past.length > 0 || state.future.length > 0 || state.checkpointActive) {
    return state
  }
  if (!snapshot.outfitId || snapshot.outfitId !== anchor.outfitId || !hasAnySlotId(snapshot)) {
    return state
  }
  const normalized = normalizeSnapshot(snapshot) as StudioHistorySnapshot
  return {
    ...state,
    present: normalized,
    checkpointSnapshot: normalized,
  }
}

export function recordChangeState(
  state: StudioHistoryState,
  nextSnapshot: StudioHistorySnapshot,
  fallbackPresent: StudioHistorySnapshot | null = null,
): StudioHistoryState {
  const normalized = normalizeSnapshot(nextSnapshot) as StudioHistorySnapshot
  if (!normalized.outfitId) {
    return state
  }
  const present = state.present ?? fallbackPresent
  if (snapshotsEqual(present, normalized)) {
    return state
  }
  const nextPast = present ? [...state.past, present] : [...state.past]
  return {
    past: nextPast.length > MAX_HISTORY ? nextPast.slice(nextPast.length - MAX_HISTORY) : nextPast,
    present: normalized,
    future: [],
    // Editing off the anchor is a new line of work: leave the anchor where it
    // is and drop the parked edits, so the button reads "back to the original
    // look" again and actually gets you there.
    checkpointSnapshot: state.checkpointSnapshot,
    checkpointActive: false,
    preCheckpointHistory: state.checkpointActive ? null : state.preCheckpointHistory,
  }
}

export function undoState(state: StudioHistoryState): Applied {
  if (state.past.length === 0 || !state.present) {
    return { state, snapshotToApply: null }
  }
  const previous = state.past[state.past.length - 1]
  return {
    state: {
      ...state,
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
    },
    snapshotToApply: previous,
  }
}

export function redoState(state: StudioHistoryState): Applied {
  if (state.future.length === 0 || !state.present) {
    return { state, snapshotToApply: null }
  }
  const next = state.future[0]
  return {
    state: {
      ...state,
      past: [...state.past, state.present].slice(-MAX_HISTORY),
      present: next,
      future: state.future.slice(1),
    },
    snapshotToApply: next,
  }
}

export function toggleCheckpointState(
  state: StudioHistoryState,
  fallbackPresent: StudioHistorySnapshot | null = null,
): Applied {
  if (!state.checkpointActive) {
    const anchor = state.checkpointSnapshot ?? state.present ?? fallbackPresent
    if (!anchor) {
      return { state, snapshotToApply: null }
    }
    return {
      state: {
        past: [],
        present: anchor,
        future: [],
        checkpointSnapshot: state.checkpointSnapshot ?? anchor,
        checkpointActive: true,
        preCheckpointHistory: {
          past: state.past,
          present: state.present ?? fallbackPresent,
          future: state.future,
        },
      },
      snapshotToApply: anchor,
    }
  }

  const parked = state.preCheckpointHistory
  const restoredPresent = parked?.present ?? state.present
  return {
    state: {
      past: parked?.past ?? state.past,
      present: restoredPresent ?? state.present,
      future: parked?.future ?? state.future,
      // Deliberately unchanged: coming back to your edits must never turn them
      // into "the original look".
      checkpointSnapshot: state.checkpointSnapshot,
      checkpointActive: false,
      preCheckpointHistory: null,
    },
    snapshotToApply: restoredPresent ?? null,
  }
}
