import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { useAuth } from "@/contexts/AuthContext"
import { useStudioContext } from "@/features/studio/context/StudioContext"
import {
  buildStudioSearchParams,
  parseStudioSearchParams,
  type SlotIdMap,
} from "@/features/studio/utils/studioUrlState"
import type { StudioProductTraySlot } from "@/services/studio/studioService"

const HISTORY_STORAGE_VERSION = "v1"
const HISTORY_STORAGE_PREFIX = "studio-history"
const MAX_HISTORY = 7

type NormalizedSlotIds = {
  top: string | null
  bottom: string | null
  shoes: string | null
}

type HiddenSlotMap = {
  top: boolean
  bottom: boolean
  shoes: boolean
}

export type StudioHistorySnapshot = {
  outfitId: string | null
  slotIds: NormalizedSlotIds
  hiddenSlots: HiddenSlotMap
}

type StudioHistoryState = {
  past: StudioHistorySnapshot[]
  present: StudioHistorySnapshot | null
  future: StudioHistorySnapshot[]
  checkpointSnapshot: StudioHistorySnapshot | null
  checkpointActive: boolean
  checkpointDirty: boolean
  preCheckpointSnapshot: StudioHistorySnapshot | null
  preCheckpointHistory: {
    past: StudioHistorySnapshot[]
    present: StudioHistorySnapshot | null
    future: StudioHistorySnapshot[]
  } | null
}

function normalizeSlotIds(slotIds: SlotIdMap = {}): NormalizedSlotIds {
  return {
    top: slotIds.top ?? null,
    bottom: slotIds.bottom ?? null,
    shoes: slotIds.shoes ?? null,
  }
}

function normalizeHiddenSlots(hiddenSlots?: Partial<Record<StudioProductTraySlot, boolean>>): HiddenSlotMap {
  return {
    top: Boolean(hiddenSlots?.top),
    bottom: Boolean(hiddenSlots?.bottom),
    shoes: Boolean(hiddenSlots?.shoes),
  }
}

function normalizeSnapshot(snapshot: StudioHistorySnapshot | null): StudioHistorySnapshot | null {
  if (!snapshot) {
    return null
  }
  return {
    outfitId: snapshot.outfitId ?? null,
    slotIds: normalizeSlotIds(snapshot.slotIds ?? {}),
    hiddenSlots: normalizeHiddenSlots((snapshot as StudioHistorySnapshot).hiddenSlots),
  }
}

function normalizeHistoryState(state: StudioHistoryState): StudioHistoryState {
  return {
    ...state,
    past: state.past.map((entry) => normalizeSnapshot(entry)).filter(Boolean) as StudioHistorySnapshot[],
    present: normalizeSnapshot(state.present),
    future: state.future.map((entry) => normalizeSnapshot(entry)).filter(Boolean) as StudioHistorySnapshot[],
    checkpointSnapshot: normalizeSnapshot(state.checkpointSnapshot),
    preCheckpointSnapshot: normalizeSnapshot(state.preCheckpointSnapshot),
    preCheckpointHistory: state.preCheckpointHistory
      ? {
          past: state.preCheckpointHistory.past.map((entry) => normalizeSnapshot(entry)).filter(Boolean) as StudioHistorySnapshot[],
          present: normalizeSnapshot(state.preCheckpointHistory.present),
          future: state.preCheckpointHistory.future.map((entry) => normalizeSnapshot(entry)).filter(Boolean) as StudioHistorySnapshot[],
        }
      : null,
  }
}

function buildSnapshotFromSearchParams(searchParams: URLSearchParams): StudioHistorySnapshot {
  const parsed = parseStudioSearchParams(searchParams)
  return {
    outfitId: parsed.outfitId,
    slotIds: normalizeSlotIds(parsed.slotIds),
    hiddenSlots: normalizeHiddenSlots(parsed.hiddenSlots),
  }
}

function snapshotsEqual(a: StudioHistorySnapshot | null, b: StudioHistorySnapshot | null): boolean {
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

function buildStorageKey(userId: string | null | undefined): string {
  const owner = userId ?? "anon"
  return `${HISTORY_STORAGE_PREFIX}-${HISTORY_STORAGE_VERSION}:${owner}:session`
}

function loadHistory(key: string): StudioHistoryState | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as StudioHistoryState
    if (!parsed || !Array.isArray(parsed.past) || !Array.isArray(parsed.future)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function saveHistory(key: string, state: StudioHistoryState) {
  if (typeof window === "undefined") {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Best effort persistence.
  }
}

export function useStudioHistory() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { setSelectedOutfitId, setSlotProductId } = useStudioContext()

  const currentSnapshot = useMemo(
    () => buildSnapshotFromSearchParams(searchParams),
    [searchParams],
  )
  const currentShare = useMemo(
    () => parseStudioSearchParams(searchParams).share === true,
    [searchParams],
  )

  const storageKey = useMemo(
    () => buildStorageKey(user?.id),
    [user?.id],
  )

  const [history, setHistory] = useState<StudioHistoryState>(() => ({
    past: [],
    present: currentSnapshot,
    future: [],
    checkpointSnapshot: currentSnapshot,
    checkpointActive: false,
    checkpointDirty: false,
    preCheckpointSnapshot: null,
    preCheckpointHistory: null,
  }))

  const [hasHydrated, setHasHydrated] = useState(false)

  const lastStorageKeyRef = useRef<string | null>(null)
  const lastOutfitIdRef = useRef<string | null>(currentSnapshot.outfitId)
  const internalApplyRef = useRef(false)
  const hydratedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastStorageKeyRef.current === storageKey) {
      return
    }
    lastStorageKeyRef.current = storageKey
    setHasHydrated(false)
    const stored = loadHistory(storageKey)
    if (stored?.present && stored.present.outfitId === currentSnapshot.outfitId) {
      const normalizedStored = normalizeHistoryState(stored)
      setHistory({
        ...normalizedStored,
        checkpointSnapshot: normalizedStored.checkpointSnapshot ?? currentSnapshot,
        checkpointActive: normalizedStored.checkpointActive ?? false,
        checkpointDirty: normalizedStored.checkpointDirty ?? false,
        preCheckpointSnapshot: normalizedStored.preCheckpointSnapshot ?? null,
        preCheckpointHistory: normalizedStored.preCheckpointHistory ?? null,
      })
      hydratedKeyRef.current = storageKey
      setHasHydrated(true)
      return
    }
    setHistory({
      past: [],
      present: currentSnapshot,
      future: [],
      checkpointSnapshot: currentSnapshot,
      checkpointActive: false,
      checkpointDirty: false,
      preCheckpointSnapshot: null,
      preCheckpointHistory: null,
    })
    hydratedKeyRef.current = storageKey
    setHasHydrated(true)
  }, [currentSnapshot, storageKey])

  useEffect(() => {
    if (lastOutfitIdRef.current === currentSnapshot.outfitId) {
      return
    }
    const isInternal = internalApplyRef.current
    lastOutfitIdRef.current = currentSnapshot.outfitId
    if (isInternal) {
      internalApplyRef.current = false
      return
    }
    setHistory({
      past: [],
      present: currentSnapshot,
      future: [],
      checkpointSnapshot: currentSnapshot,
      checkpointActive: false,
      checkpointDirty: false,
      preCheckpointSnapshot: null,
      preCheckpointHistory: null,
    })
    hydratedKeyRef.current = storageKey
    setHasHydrated(true)
  }, [currentSnapshot])

  useEffect(() => {
    if (!storageKey) {
      return
    }
    if (!hasHydrated || hydratedKeyRef.current !== storageKey) {
      return
    }
    saveHistory(storageKey, history)
  }, [hasHydrated, history, storageKey])

  const applySnapshot = useCallback(
    (snapshot: StudioHistorySnapshot) => {
      if (snapshot.outfitId !== currentSnapshot.outfitId) {
        internalApplyRef.current = true
      }
      setSelectedOutfitId(snapshot.outfitId)
      setSlotProductId("top", snapshot.slotIds.top)
      setSlotProductId("bottom", snapshot.slotIds.bottom)
      setSlotProductId("shoes", snapshot.slotIds.shoes)
      const params = buildStudioSearchParams({
        outfitId: snapshot.outfitId,
        slotIds: snapshot.slotIds,
        hiddenSlots: snapshot.hiddenSlots,
        share: currentShare,
      })
      setSearchParams(params, { replace: true })
    },
    [currentShare, currentSnapshot.outfitId, setSearchParams, setSelectedOutfitId, setSlotProductId],
  )

  const recordChange = useCallback(
    (nextSnapshot: StudioHistorySnapshot) => {
      const normalized: StudioHistorySnapshot = {
        outfitId: nextSnapshot.outfitId,
        slotIds: normalizeSlotIds(nextSnapshot.slotIds),
        hiddenSlots: normalizeHiddenSlots(nextSnapshot.hiddenSlots),
      }
      if (!normalized.outfitId) {
        return
      }
      setHistory((prev) => {
        const present = prev.present ?? currentSnapshot
        if (snapshotsEqual(present, normalized)) {
          return prev
        }
        const nextPast = present ? [...prev.past, present] : [...prev.past]
        const cappedPast =
          nextPast.length > MAX_HISTORY
            ? nextPast.slice(nextPast.length - MAX_HISTORY)
            : nextPast
        return {
          past: cappedPast,
          present: normalized,
          future: [],
          checkpointSnapshot: prev.checkpointSnapshot,
          checkpointActive: prev.checkpointActive,
          checkpointDirty: prev.checkpointActive ? true : prev.checkpointDirty,
          preCheckpointSnapshot: prev.preCheckpointSnapshot,
          preCheckpointHistory: prev.preCheckpointHistory,
        }
      })
    },
    [currentSnapshot],
  )

  const undo = useCallback(() => {
    let snapshotToApply: StudioHistorySnapshot | null = null
    setHistory((prev) => {
      if (prev.past.length === 0 || !prev.present) {
        return prev
      }
      const previous = prev.past[prev.past.length - 1]
      snapshotToApply = previous
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future],
        checkpointSnapshot: prev.checkpointSnapshot,
        checkpointActive: prev.checkpointActive,
        checkpointDirty: prev.checkpointDirty,
        preCheckpointSnapshot: prev.preCheckpointSnapshot,
        preCheckpointHistory: prev.preCheckpointHistory,
      }
    })
    if (snapshotToApply) {
      applySnapshot(snapshotToApply)
    }
  }, [applySnapshot])

  const redo = useCallback(() => {
    let snapshotToApply: StudioHistorySnapshot | null = null
    setHistory((prev) => {
      if (prev.future.length === 0 || !prev.present) {
        return prev
      }
      const next = prev.future[0]
      snapshotToApply = next
      return {
        past: [...prev.past, prev.present].slice(-MAX_HISTORY),
        present: next,
        future: prev.future.slice(1),
        checkpointSnapshot: prev.checkpointSnapshot,
        checkpointActive: prev.checkpointActive,
        checkpointDirty: prev.checkpointDirty,
        preCheckpointSnapshot: prev.preCheckpointSnapshot,
        preCheckpointHistory: prev.preCheckpointHistory,
      }
    })
    if (snapshotToApply) {
      applySnapshot(snapshotToApply)
    }
  }, [applySnapshot])

  const toggleCheckpoint = useCallback(() => {
    let snapshotToApply: StudioHistorySnapshot | null = null
    setHistory((prev) => {
      if (!prev.checkpointActive) {
        const nextCheckpoint = prev.checkpointSnapshot ?? prev.present ?? currentSnapshot
        snapshotToApply = nextCheckpoint
        return {
          past: [],
          present: nextCheckpoint,
          future: [],
          checkpointSnapshot: prev.checkpointSnapshot,
          checkpointActive: true,
          checkpointDirty: false,
          preCheckpointSnapshot: prev.present ?? currentSnapshot,
          preCheckpointHistory: {
            past: prev.past,
            present: prev.present,
            future: prev.future,
          },
        }
      }
      const shouldRestore = Boolean(prev.preCheckpointHistory)
      const restoredPresent = prev.preCheckpointHistory?.present ?? prev.preCheckpointSnapshot ?? prev.present
      if (restoredPresent) {
        snapshotToApply = restoredPresent
      }
      return {
        past: shouldRestore ? prev.preCheckpointHistory?.past ?? [] : prev.past,
        present: shouldRestore ? restoredPresent ?? prev.present : prev.present,
        future: shouldRestore ? prev.preCheckpointHistory?.future ?? [] : prev.future,
        checkpointSnapshot: prev.checkpointDirty && prev.present ? prev.present : prev.checkpointSnapshot,
        checkpointActive: false,
        checkpointDirty: false,
        preCheckpointSnapshot: null,
        preCheckpointHistory: null,
      }
    })
    if (snapshotToApply) {
      applySnapshot(snapshotToApply)
    }
  }, [applySnapshot, currentSnapshot])

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  return {
    canRedo,
    canUndo,
    checkpointActive: history.checkpointActive,
    recordChange,
    redo,
    applySnapshot,
    toggleCheckpoint,
    undo,
  }
}
