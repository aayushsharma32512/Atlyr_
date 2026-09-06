import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { useAuth } from "@/contexts/AuthContext"
import { useStudioContext } from "@/features/studio/context/StudioContext"
import {
  buildStudioSearchParams,
  parseStudioSearchParams,
} from "@/features/studio/utils/studioUrlState"
import {
  anchoredState,
  normalizeHiddenSlots,
  normalizeHistoryState,
  normalizeSlotIds,
  recordChangeState,
  redoState,
  studioHistoryStorageKey,
  toggleCheckpointState,
  undoState,
  upgradeAnchorState,
  type StudioHistorySnapshot,
  type StudioHistoryState,
} from "@/features/studio/utils/studioHistoryState"

export type { StudioHistorySnapshot } from "@/features/studio/utils/studioHistoryState"

function buildSnapshotFromSearchParams(searchParams: URLSearchParams): StudioHistorySnapshot {
  const parsed = parseStudioSearchParams(searchParams)
  return {
    outfitId: parsed.outfitId,
    slotIds: normalizeSlotIds(parsed.slotIds),
    hiddenSlots: normalizeHiddenSlots(parsed.hiddenSlots),
  }
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
    () => studioHistoryStorageKey(user?.id),
    [user?.id],
  )

  const [history, setHistory] = useState<StudioHistoryState>(() => anchoredState(currentSnapshot))

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
      })
      hydratedKeyRef.current = storageKey
      setHasHydrated(true)
      return
    }
    setHistory(anchoredState(currentSnapshot))
    hydratedKeyRef.current = storageKey
    setHasHydrated(true)
  }, [currentSnapshot, storageKey])

  // Opening a different outfit re-anchors everything: the look you arrived with
  // becomes the one the restore button returns to.
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
    setHistory(anchoredState(currentSnapshot))
    hydratedKeyRef.current = storageKey
    setHasHydrated(true)
  }, [currentSnapshot])

  // On a cold start the outfit id lands in the URL a tick before the slot ids
  // do, so the anchor taken above can be outfit-only. Complete it once, while
  // the stack is still untouched.
  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    setHistory((prev) => upgradeAnchorState(prev, currentSnapshot))
  }, [currentSnapshot, hasHydrated])

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
      setHistory((prev) => recordChangeState(prev, nextSnapshot, currentSnapshot))
    },
    [currentSnapshot],
  )

  const undo = useCallback(() => {
    let snapshotToApply: StudioHistorySnapshot | null = null
    setHistory((prev) => {
      const result = undoState(prev)
      snapshotToApply = result.snapshotToApply
      return result.state
    })
    if (snapshotToApply) {
      applySnapshot(snapshotToApply)
    }
  }, [applySnapshot])

  const redo = useCallback(() => {
    let snapshotToApply: StudioHistorySnapshot | null = null
    setHistory((prev) => {
      const result = redoState(prev)
      snapshotToApply = result.snapshotToApply
      return result.state
    })
    if (snapshotToApply) {
      applySnapshot(snapshotToApply)
    }
  }, [applySnapshot])

  const toggleCheckpoint = useCallback(() => {
    let snapshotToApply: StudioHistorySnapshot | null = null
    setHistory((prev) => {
      const result = toggleCheckpointState(prev, currentSnapshot)
      snapshotToApply = result.snapshotToApply
      return result.state
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
