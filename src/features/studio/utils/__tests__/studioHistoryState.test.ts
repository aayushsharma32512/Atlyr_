import { describe, expect, it } from "@jest/globals"

import {
  MAX_HISTORY,
  anchoredState,
  recordChangeState,
  redoState,
  seededState,
  snapshotsEqual,
  studioHistoryStorageKey,
  toggleCheckpointState,
  undoState,
  upgradeAnchorState,
  type StudioHistorySnapshot,
} from "../studioHistoryState"

const snap = (outfitId: string | null, top: string | null, bottom: string | null = "B", shoes: string | null = "S"): StudioHistorySnapshot => ({
  outfitId,
  slotIds: { top, bottom, shoes },
  hiddenSlots: { top: false, bottom: false, shoes: false },
})

const LANDED = snap("A", "T1")

describe("studioHistoryState — anchoring", () => {
  it("anchors a fresh state on the snapshot the studio landed with", () => {
    const state = anchoredState(LANDED)
    expect(state.present).toEqual(LANDED)
    expect(state.checkpointSnapshot).toEqual(LANDED)
    expect(state.checkpointActive).toBe(false)
    expect(state.past).toEqual([])
    expect(state.future).toEqual([])
  })
})

describe("studioHistoryState — restore returns to the landing look", () => {
  it("restores the landing look after any number of edits", () => {
    let state = anchoredState(LANDED)
    state = recordChangeState(state, snap("A", "T2"))
    state = recordChangeState(state, snap("A", "T3"))
    state = recordChangeState(state, snap("A", "T4"))

    const { state: restored, snapshotToApply } = toggleCheckpointState(state)

    expect(snapshotToApply).toEqual(LANDED)
    expect(restored.checkpointActive).toBe(true)
    expect(restored.present).toEqual(LANDED)
  })

  it("comes back to the parked edits when toggled again with nothing changed", () => {
    let state = anchoredState(LANDED)
    state = recordChangeState(state, snap("A", "T2"))

    const first = toggleCheckpointState(state)
    const second = toggleCheckpointState(first.state)

    expect(second.snapshotToApply).toEqual(snap("A", "T2"))
    expect(second.state.checkpointActive).toBe(false)
    expect(second.state.past).toEqual([LANDED])
  })

  it("never redefines the landing look, even when edits are made while restored", () => {
    let state = anchoredState(LANDED)
    state = recordChangeState(state, snap("A", "T2"))
    state = toggleCheckpointState(state).state

    // Editing from the restored look is a new line of work, not a new anchor.
    state = recordChangeState(state, snap("A", "T9"))
    expect(state.checkpointActive).toBe(false)
    expect(state.checkpointSnapshot).toEqual(LANDED)

    const { snapshotToApply } = toggleCheckpointState(state)
    expect(snapshotToApply).toEqual(LANDED)
  })

  it("keeps restoring the landing look across repeated restore/edit cycles", () => {
    let state = anchoredState(LANDED)
    for (let i = 0; i < 5; i += 1) {
      // Editing while restored drops the checkpoint, so each pass is
      // edit-then-restore and each restore must land back on LANDED.
      state = recordChangeState(state, snap("A", `X${i}`))
      expect(state.checkpointActive).toBe(false)
      const toggled = toggleCheckpointState(state)
      expect(toggled.snapshotToApply).toEqual(LANDED)
      state = toggled.state
    }
  })
})

describe("studioHistoryState — anchor upgrade", () => {
  const bare = snap("A", null, null, null)

  it("upgrades an anchor captured before the slot params landed in the URL", () => {
    const state = anchoredState(bare)
    const upgraded = upgradeAnchorState(state, LANDED)

    expect(upgraded.checkpointSnapshot).toEqual(LANDED)
    expect(upgraded.present).toEqual(LANDED)
  })

  it("leaves the anchor alone once it already carries slot ids", () => {
    const state = anchoredState(LANDED)
    expect(upgradeAnchorState(state, snap("A", "T2"))).toBe(state)
  })

  it("leaves the anchor alone once the user has edited", () => {
    let state = anchoredState(bare)
    state = recordChangeState(state, snap("A", "T2"))
    expect(upgradeAnchorState(state, LANDED)).toBe(state)
  })

  it("leaves the anchor alone for a different outfit", () => {
    const state = anchoredState(bare)
    expect(upgradeAnchorState(state, snap("B", "T1"))).toBe(state)
  })
})

describe("studioHistoryState — record/undo/redo", () => {
  it("ignores a change that matches the present", () => {
    const state = anchoredState(LANDED)
    expect(recordChangeState(state, snap("A", "T1"))).toBe(state)
  })

  it("ignores a change with no outfit", () => {
    const state = anchoredState(LANDED)
    expect(recordChangeState(state, snap(null, "T2"))).toBe(state)
  })

  it("caps the past at MAX_HISTORY entries", () => {
    let state = anchoredState(LANDED)
    for (let i = 0; i < MAX_HISTORY + 4; i += 1) {
      state = recordChangeState(state, snap("A", `T${i}`))
    }
    expect(state.past).toHaveLength(MAX_HISTORY)
  })

  it("clears the redo stack on a new change", () => {
    let state = anchoredState(LANDED)
    state = recordChangeState(state, snap("A", "T2"))
    state = undoState(state).state
    expect(state.future).toHaveLength(1)
    state = recordChangeState(state, snap("A", "T3"))
    expect(state.future).toHaveLength(0)
  })

  it("walks back and forward through the stack", () => {
    let state = anchoredState(LANDED)
    state = recordChangeState(state, snap("A", "T2"))

    const undone = undoState(state)
    expect(undone.snapshotToApply).toEqual(LANDED)

    const redone = redoState(undone.state)
    expect(redone.snapshotToApply).toEqual(snap("A", "T2"))
  })

  it("is a no-op at either end of the stack", () => {
    const state = anchoredState(LANDED)
    expect(undoState(state).snapshotToApply).toBeNull()
    expect(redoState(state).snapshotToApply).toBeNull()
  })
})

describe("studioHistoryState — snapshotsEqual", () => {
  it("compares outfit, slots and hidden slots", () => {
    expect(snapshotsEqual(LANDED, snap("A", "T1"))).toBe(true)
    expect(snapshotsEqual(LANDED, snap("A", "T2"))).toBe(false)
    expect(snapshotsEqual(LANDED, snap("B", "T1"))).toBe(false)
    expect(snapshotsEqual(null, LANDED)).toBe(false)
  })
})

describe("studioHistoryState — seeding from outside the studio", () => {
  it("anchors on the look being opened, with the previous look left for undo", () => {
    const previous = snap("Z", "OLD")
    const state = seededState(LANDED, [previous])

    expect(state.present).toEqual(LANDED)
    expect(state.checkpointSnapshot).toEqual(LANDED)
    expect(state.past).toEqual([previous])
    expect(state.future).toEqual([])
    expect(state.checkpointActive).toBe(false)
  })

  it("restores the opened look, not the seeded past", () => {
    const state = recordChangeState(seededState(LANDED, [snap("Z", "OLD")]), snap("A", "T2"))
    expect(toggleCheckpointState(state).snapshotToApply).toEqual(LANDED)
  })

  it("caps the seeded past at MAX_HISTORY", () => {
    const past = Array.from({ length: MAX_HISTORY + 3 }, (_, i) => snap("Z", `OLD${i}`))
    expect(seededState(LANDED, past).past).toHaveLength(MAX_HISTORY)
  })

  it("scopes the storage key per user and falls back to anon", () => {
    expect(studioHistoryStorageKey("user-1")).not.toEqual(studioHistoryStorageKey("user-2"))
    expect(studioHistoryStorageKey(null)).toContain("anon")
  })
})
