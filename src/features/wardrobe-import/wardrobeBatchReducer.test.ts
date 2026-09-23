import { afterAll, beforeEach, describe, expect, it } from "@jest/globals"

import {
  clearWardrobeBatch,
  readWardrobeBatch,
  writeWardrobeBatch,
} from "@/features/wardrobe-import/batchStorage"
import { detectionStatusFromImport, syncedDetectionStatus } from "@/features/wardrobe-import/importStatus"
import { photoProgress } from "@/features/wardrobe-import/photoProgress"
import {
  MAX_WARDROBE_PHOTOS,
  emptyWardrobeBatch,
  wardrobeBatchReducer,
} from "@/features/wardrobe-import/wardrobeBatchReducer"
import type {
  WardrobeBatch,
  WardrobePhoto,
  WardrobePieceSelection,
} from "@/features/wardrobe-import/types"

function photo(id: string, overrides: Partial<WardrobePhoto> = {}): WardrobePhoto {
  return {
    id,
    importId: null,
    previewUrl: `blob:${id}`,
    detectionStatus: "pending",
    confirmedPieceIds: [],
    piecesDefaulted: false,
    step: "pieces",
    selections: {},
    railByPiece: {},
    ...overrides,
  }
}

function selection(candidateId: string, productId: string): WardrobePieceSelection {
  return {
    source: "inventory",
    productId,
    title: productId,
    imageUrl: `https://cdn/${productId}.jpg`,
    candidateId,
  }
}

function webSelection(candidateId: string, listingUrl: string): WardrobePieceSelection {
  return {
    source: "web",
    listingUrl,
    title: listingUrl,
    imageUrl: `https://cdn/${candidateId}.jpg`,
    selectionToken: `token-${candidateId}`,
    candidateId,
  }
}

function batchOf(photos: WardrobePhoto[], overrides: Partial<WardrobeBatch> = {}): WardrobeBatch {
  return { stage: "identify", photos, activePhotoId: photos[0]?.id ?? null, ...overrides }
}

describe("wardrobeBatchReducer", () => {
  it("adds photos up to the cap and drops the extras", () => {
    const photos = Array.from({ length: MAX_WARDROBE_PHOTOS + 3 }, (_, index) => photo(`p${index}`))
    const next = wardrobeBatchReducer(emptyWardrobeBatch, { type: "addPhotos", photos })
    expect(next.photos).toHaveLength(MAX_WARDROBE_PHOTOS)
    expect(next.photos.at(-1)?.id).toBe(`p${MAX_WARDROBE_PHOTOS - 1}`)
  })

  it("ignores more photos once the batch is full", () => {
    const full = batchOf(Array.from({ length: MAX_WARDROBE_PHOTOS }, (_, index) => photo(`p${index}`)))
    expect(wardrobeBatchReducer(full, { type: "addPhotos", photos: [photo("extra")] })).toBe(full)
  })

  it("moves the active photo to its neighbour when the active one is removed", () => {
    const state = batchOf([photo("a"), photo("b"), photo("c")], { activePhotoId: "b" })
    const next = wardrobeBatchReducer(state, { type: "removePhoto", photoId: "b" })
    expect(next.photos.map((item) => item.id)).toEqual(["a", "c"])
    expect(next.activePhotoId).toBe("c")
  })

  it("returns to the add stage when the last photo is removed", () => {
    const state = batchOf([photo("a")])
    const next = wardrobeBatchReducer(state, { type: "removePhoto", photoId: "a" })
    expect(next).toEqual(emptyWardrobeBatch)
  })

  it("opens the identify stage on the first photo", () => {
    const state: WardrobeBatch = { stage: "add", photos: [photo("a"), photo("b")], activePhotoId: null }
    const next = wardrobeBatchReducer(state, { type: "startIdentify" })
    expect(next.stage).toBe("identify")
    expect(next.activePhotoId).toBe("a")
  })

  it("fills the preview url from the import row only while the photo has none", () => {
    const state = batchOf([photo("a", { previewUrl: "" })])
    const filled = wardrobeBatchReducer(state, {
      type: "setDetectionStatus", photoId: "a", status: "detecting", previewUrl: "https://signed/a",
    })
    expect(filled.photos[0].previewUrl).toBe("https://signed/a")

    const kept = wardrobeBatchReducer(filled, {
      type: "setDetectionStatus", photoId: "a", status: "complete", previewUrl: "https://signed/other",
    })
    expect(kept.photos[0].previewUrl).toBe("https://signed/a")
  })

  it("keeps state identical when a detection status repeats", () => {
    const state = batchOf([photo("a", { detectionStatus: "complete" })])
    expect(wardrobeBatchReducer(state, { type: "setDetectionStatus", photoId: "a", status: "complete" })).toBe(state)
  })

  it("defaults pieces once and never over a user's own choice", () => {
    const state = batchOf([photo("a")])
    const defaulted = wardrobeBatchReducer(state, { type: "applyDefaultPieces", photoId: "a", candidateIds: ["c1"] })
    expect(defaulted.photos[0].confirmedPieceIds).toEqual(["c1"])

    const cleared = wardrobeBatchReducer(defaulted, { type: "setConfirmedPieces", photoId: "a", candidateIds: [] })
    const reDefaulted = wardrobeBatchReducer(cleared, { type: "applyDefaultPieces", photoId: "a", candidateIds: ["c1"] })
    expect(reDefaulted.photos[0].confirmedPieceIds).toEqual([])
  })

  it("puts a retried photo back in the queue", () => {
    const state = batchOf([photo("a", { detectionStatus: "failed", importId: "import-a" })])
    const next = wardrobeBatchReducer(state, { type: "retryPhoto", photoId: "a" })
    expect(next.photos[0].detectionStatus).toBe("pending")
    expect(next.photos[0].importId).toBe("import-a")
  })

  it("replaces the pick of a piece and rail, and clears it on demand", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1"] })])
    const first = wardrobeBatchReducer(state, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "inventory", selection: selection("c1", "p1"),
    })
    expect(first.photos[0].selections.top?.inventory?.productId).toBe("p1")

    const replaced = wardrobeBatchReducer(first, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "inventory", selection: selection("c1", "p2"),
    })
    expect(replaced.photos[0].selections.top?.inventory?.productId).toBe("p2")

    const cleared = wardrobeBatchReducer(replaced, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "inventory", selection: null,
    })
    expect(cleared.photos[0].selections.top).toBeUndefined()
    expect(Object.keys(cleared.photos[0].selections)).toEqual([])
  })

  it("keeps an inventory pick and a web pick on the same piece", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1"] })])
    const withInventory = wardrobeBatchReducer(state, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "inventory", selection: selection("c1", "p1"),
    })
    const withBoth = wardrobeBatchReducer(withInventory, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "web", selection: webSelection("c1", "https://shop/1"),
    })
    expect(withBoth.photos[0].selections.top?.inventory?.productId).toBe("p1")
    expect(withBoth.photos[0].selections.top?.web?.listingUrl).toBe("https://shop/1")

    const clearedWeb = wardrobeBatchReducer(withBoth, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "web", selection: null,
    })
    expect(clearedWeb.photos[0].selections.top?.web).toBeUndefined()
    expect(clearedWeb.photos[0].selections.top?.inventory?.productId).toBe("p1")
  })

  it("keeps one pick per piece while other pieces keep theirs", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1", "c2"] })])
    const withTop = wardrobeBatchReducer(state, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "inventory", selection: selection("c1", "p1"),
    })
    const withBoth = wardrobeBatchReducer(withTop, {
      type: "setSelection", photoId: "a", pieceType: "bottom", source: "inventory", selection: selection("c2", "p2"),
    })
    expect(withBoth.photos[0].selections.top?.inventory?.productId).toBe("p1")
    expect(withBoth.photos[0].selections.bottom?.inventory?.productId).toBe("p2")

    const clearedTop = wardrobeBatchReducer(withBoth, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "inventory", selection: null,
    })
    expect(clearedTop.photos[0].selections.top).toBeUndefined()
    expect(clearedTop.photos[0].selections.bottom?.inventory?.productId).toBe("p2")
  })

  it("drops both picks of a piece the user takes off the photo", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1", "c2"] })])
    const picked = wardrobeBatchReducer(state, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "inventory", selection: selection("c1", "p1"),
    })
    const both = wardrobeBatchReducer(picked, {
      type: "setSelection", photoId: "a", pieceType: "top", source: "web", selection: webSelection("c1", "https://shop/1"),
    })
    const reduced = wardrobeBatchReducer(both, {
      type: "setConfirmedPieces", photoId: "a", candidateIds: ["c2"],
    })
    expect(reduced.photos[0].selections.top).toBeUndefined()
  })

  it("remembers the rail each piece was last on", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1"] })])
    const next = wardrobeBatchReducer(state, {
      type: "setPieceSource", photoId: "a", candidateId: "c1", source: "web",
    })
    expect(next.photos[0].railByPiece.c1).toBe("web")
    expect(wardrobeBatchReducer(next, {
      type: "setPieceSource", photoId: "a", candidateId: "c1", source: "web",
    })).toBe(next)
  })

  it("stamps only the named picks as sent on, once", () => {
    const state = batchOf([photo("a", {
      confirmedPieceIds: ["c1", "c2"],
      step: "matches",
      selections: {
        top: { inventory: selection("c1", "p1"), web: webSelection("c1", "https://shop/1") },
        bottom: { web: webSelection("c2", "https://shop/2") },
      },
    })])
    const next = wardrobeBatchReducer(state, {
      type: "markCommitted", photoId: "a", picks: [{ type: "top", source: "web" }], at: 10,
    })
    expect(next.photos[0].selections.top?.web?.committedAt).toBe(10)
    expect(next.photos[0].selections.top?.inventory?.committedAt).toBeUndefined()
    expect(next.photos[0].selections.bottom?.web?.committedAt).toBeUndefined()

    expect(wardrobeBatchReducer(next, {
      type: "markCommitted", photoId: "a", picks: [{ type: "top", source: "web" }], at: 20,
    })).toBe(next)
  })

  it("ignores a stamp for a piece with nothing picked", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1"], step: "matches" })])
    expect(wardrobeBatchReducer(state, {
      type: "markCommitted", photoId: "a", picks: [{ type: "top", source: "inventory" }], at: 10,
    })).toBe(state)
  })

  it("restores the stage and the photo the user left", () => {
    const stored = batchOf(
      [
        photo("a", { importId: "import-a", previewUrl: "" }),
        photo("b", {
          importId: "import-b",
          previewUrl: "",
          step: "matches",
          confirmedPieceIds: ["c1"],
          selections: { top: { inventory: selection("c1", "p1") } },
          railByPiece: { c1: "web" },
        }),
      ],
      { stage: "identify", activePhotoId: "b" },
    )
    const next = wardrobeBatchReducer(emptyWardrobeBatch, { type: "restore", batch: stored })
    expect(next).toEqual(stored)
  })

  it("keeps the batch in place when the restore has no photos", () => {
    const state = batchOf([photo("a")])
    expect(wardrobeBatchReducer(state, { type: "restore", batch: emptyWardrobeBatch })).toBe(state)
  })
})

describe("detection status mapping", () => {
  it("maps the import row's own vocabulary", () => {
    expect(detectionStatusFromImport("created")).toBe("detecting")
    expect(detectionStatusFromImport("source_ready")).toBe("detecting")
    expect(detectionStatusFromImport("detecting")).toBe("detecting")
    expect(detectionStatusFromImport("detected")).toBe("complete")
    expect(detectionStatusFromImport("candidate_selected")).toBe("complete")
    expect(detectionStatusFromImport("failed")).toBe("failed")
    expect(detectionStatusFromImport("expired")).toBe("failed")
  })

  it("holds a failed photo failed until it is retried", () => {
    expect(syncedDetectionStatus("failed", "source_ready")).toBe("failed")
    expect(syncedDetectionStatus("failed", "detected")).toBe("complete")
    expect(syncedDetectionStatus("detecting", "source_ready")).toBe("detecting")
  })
})

describe("photoProgress", () => {
  it("counts a photo done only once every kept piece has been sent on", () => {
    const pending = photo("a", { confirmedPieceIds: ["c1", "c2"], step: "matches" })
    expect(photoProgress(pending)).toEqual({ selected: 0, committed: 0, total: 2, complete: false })

    const picked = photo("a", {
      confirmedPieceIds: ["c1", "c2"],
      step: "matches",
      selections: {
        top: { inventory: selection("c1", "p1") },
        bottom: { inventory: selection("c2", "p2") },
      },
    })
    expect(photoProgress(picked)).toEqual({ selected: 2, committed: 0, total: 2, complete: false })

    const half = photo("a", {
      confirmedPieceIds: ["c1", "c2"],
      step: "matches",
      selections: {
        top: { inventory: { ...selection("c1", "p1"), committedAt: 1 } },
        bottom: { inventory: selection("c2", "p2") },
      },
    })
    expect(photoProgress(half)).toEqual({ selected: 2, committed: 1, total: 2, complete: false })

    const done = photo("a", {
      confirmedPieceIds: ["c1", "c2"],
      step: "matches",
      selections: {
        top: { inventory: { ...selection("c1", "p1"), committedAt: 1 } },
        bottom: { inventory: { ...selection("c2", "p2"), committedAt: 1 } },
      },
    })
    expect(photoProgress(done)).toEqual({ selected: 2, committed: 2, total: 2, complete: true })
  })

  it("counts a piece done once either of its two picks has been sent on", () => {
    const halfSent = photo("a", {
      confirmedPieceIds: ["c1"],
      step: "matches",
      selections: {
        top: {
          inventory: selection("c1", "p1"),
          web: { ...webSelection("c1", "https://shop/1"), committedAt: 1 },
        },
      },
    })
    expect(photoProgress(halfSent)).toEqual({ selected: 1, committed: 1, total: 1, complete: true })
  })

  it("counts a skipped photo done and a photo still on pieces not", () => {
    expect(photoProgress(photo("a", { step: "matches" })).complete).toBe(true)
    expect(photoProgress(photo("a", { confirmedPieceIds: ["c1"] })).complete).toBe(false)
  })
})

describe("wardrobe batch storage", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const values = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  const day = 24 * 60 * 60 * 1000

  beforeEach(() => {
    values.clear()
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } })
  })

  afterAll(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  })

  it("brings the whole batch back, without the file or its blob preview", () => {
    const saved = batchOf(
      [
        photo("a", { importId: "import-a", file: new File([], "a.jpg"), detectionStatus: "complete" }),
        photo("b", {
          importId: "import-b",
          previewUrl: "https://signed/b",
          detectionStatus: "complete",
          step: "matches",
          confirmedPieceIds: ["c1"],
          piecesDefaulted: true,
          selections: { top: { inventory: selection("c1", "p1"), web: webSelection("c1", "https://shop/1") } },
          railByPiece: { c1: "web" },
        }),
      ],
      { stage: "identify", activePhotoId: "b" },
    )
    writeWardrobeBatch("user-1", saved, 1_000)

    const restored = readWardrobeBatch("user-1", 1_000)
    expect(restored).toEqual({
      ...saved,
      photos: [{ ...saved.photos[0], file: undefined, previewUrl: "" }, saved.photos[1]],
    })
    expect(restored?.photos[0]).not.toHaveProperty("file")
  })

  it("keeps one user's batch away from another", () => {
    writeWardrobeBatch("user-1", batchOf([photo("a", { importId: "import-a" })]), 1_000)
    expect(readWardrobeBatch("user-2", 1_000)).toBeNull()
  })

  it("drops a photo that has no import row and falls back to a kept photo", () => {
    const saved = batchOf(
      [photo("a"), photo("b", { importId: "import-b" })],
      { activePhotoId: "a" },
    )
    writeWardrobeBatch("user-1", saved, 1_000)

    const restored = readWardrobeBatch("user-1", 1_000)
    expect(restored?.photos.map((item) => item.id)).toEqual(["b"])
    expect(restored?.activePhotoId).toBe("b")
  })

  it("forgets a batch with nothing left to rebuild", () => {
    writeWardrobeBatch("user-1", batchOf([photo("a")]), 1_000)
    expect(readWardrobeBatch("user-1", 1_000)).toBeNull()
    expect(values.size).toBe(0)
  })

  it("expires a batch after a day and clears it", () => {
    const saved = batchOf([photo("a", { importId: "import-a" })])
    writeWardrobeBatch("user-1", saved, 1_000)

    expect(readWardrobeBatch("user-1", 1_000 + day)).not.toBeNull()
    expect(readWardrobeBatch("user-1", 1_000 + day + 1)).toBeNull()
    expect(values.size).toBe(0)
  })

  it("reads a batch stored before a piece could hold two picks as having none", () => {
    const saved = batchOf([photo("a", {
      importId: "import-a",
      previewUrl: "https://signed/a",
      confirmedPieceIds: ["c1"],
    })])
    writeWardrobeBatch("user-1", saved, 1_000)
    const key = [...values.keys()][0]
    const stored = JSON.parse(values.get(key) as string)
    stored.batch.photos[0].selections = { top: selection("c1", "p1") }
    values.set(key, JSON.stringify(stored))

    expect(readWardrobeBatch("user-1", 1_000)?.photos[0].selections).toEqual({})
  })

  it("ignores a stored value it cannot read", () => {
    writeWardrobeBatch("user-1", batchOf([photo("a", { importId: "import-a" })]), 1_000)
    const key = [...values.keys()][0]
    values.set(key, "not json")
    expect(readWardrobeBatch("user-1", 1_000)).toBeNull()

    values.set(key, JSON.stringify({ savedAt: 1_000, batch: { stage: "nowhere", photos: [] } }))
    expect(readWardrobeBatch("user-1", 1_000)).toBeNull()
  })

  it("clears only the batch of the user it is given", () => {
    writeWardrobeBatch("user-1", batchOf([photo("a", { importId: "import-a" })]), 1_000)
    writeWardrobeBatch("user-2", batchOf([photo("b", { importId: "import-b" })]), 1_000)

    clearWardrobeBatch("user-1")
    expect(readWardrobeBatch("user-1", 1_000)).toBeNull()
    expect(readWardrobeBatch("user-2", 1_000)).not.toBeNull()
  })
})
