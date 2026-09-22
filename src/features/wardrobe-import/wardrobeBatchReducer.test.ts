import { describe, expect, it } from "@jest/globals"

import { detectionStatusFromImport, syncedDetectionStatus } from "@/features/wardrobe-import/importStatus"
import { photoProgress } from "@/features/wardrobe-import/photoProgress"
import { reviewItems } from "@/features/wardrobe-import/reviewItems"
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

  it("replaces the pick of a piece and clears it on demand", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1"] })])
    const first = wardrobeBatchReducer(state, {
      type: "setSelection", photoId: "a", pieceType: "top", selection: selection("c1", "p1"),
    })
    expect(first.photos[0].selections.top?.productId).toBe("p1")

    const replaced = wardrobeBatchReducer(first, {
      type: "setSelection", photoId: "a", pieceType: "top", selection: selection("c1", "p2"),
    })
    expect(replaced.photos[0].selections.top?.productId).toBe("p2")

    const cleared = wardrobeBatchReducer(replaced, {
      type: "setSelection", photoId: "a", pieceType: "top", selection: null,
    })
    expect(cleared.photos[0].selections.top).toBeUndefined()
    expect(Object.keys(cleared.photos[0].selections)).toEqual([])
  })

  it("keeps one pick per piece while other pieces keep theirs", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1", "c2"] })])
    const withTop = wardrobeBatchReducer(state, {
      type: "setSelection", photoId: "a", pieceType: "top", selection: selection("c1", "p1"),
    })
    const withBoth = wardrobeBatchReducer(withTop, {
      type: "setSelection", photoId: "a", pieceType: "bottom", selection: selection("c2", "p2"),
    })
    expect(withBoth.photos[0].selections.top?.productId).toBe("p1")
    expect(withBoth.photos[0].selections.bottom?.productId).toBe("p2")

    const clearedTop = wardrobeBatchReducer(withBoth, {
      type: "setSelection", photoId: "a", pieceType: "top", selection: null,
    })
    expect(clearedTop.photos[0].selections.top).toBeUndefined()
    expect(clearedTop.photos[0].selections.bottom?.productId).toBe("p2")
  })

  it("drops the pick of a piece the user takes off the photo", () => {
    const state = batchOf([photo("a", { confirmedPieceIds: ["c1", "c2"] })])
    const picked = wardrobeBatchReducer(state, {
      type: "setSelection", photoId: "a", pieceType: "top", selection: selection("c1", "p1"),
    })
    const reduced = wardrobeBatchReducer(picked, {
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

  it("restores a stored batch straight into the identify stage", () => {
    const next = wardrobeBatchReducer(emptyWardrobeBatch, {
      type: "restore",
      photos: [photo("a", { importId: "import-a", previewUrl: "" })],
    })
    expect(next.stage).toBe("identify")
    expect(next.activePhotoId).toBe("a")
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
  it("counts a photo done only once every kept piece has a pick", () => {
    const pending = photo("a", { confirmedPieceIds: ["c1", "c2"], step: "matches" })
    expect(photoProgress(pending)).toEqual({ selected: 0, total: 2, complete: false })

    const half = photo("a", {
      confirmedPieceIds: ["c1", "c2"],
      step: "matches",
      selections: { top: selection("c1", "p1") },
    })
    expect(photoProgress(half)).toEqual({ selected: 1, total: 2, complete: false })

    const done = photo("a", {
      confirmedPieceIds: ["c1", "c2"],
      step: "matches",
      selections: { top: selection("c1", "p1"), bottom: selection("c2", "p2") },
    })
    expect(photoProgress(done)).toEqual({ selected: 2, total: 2, complete: true })
  })

  it("counts a skipped photo done and a photo still on pieces not", () => {
    expect(photoProgress(photo("a", { step: "matches" })).complete).toBe(true)
    expect(photoProgress(photo("a", { confirmedPieceIds: ["c1"] })).complete).toBe(false)
  })
})

describe("reviewItems", () => {
  it("splits the batch into inventory and web picks", () => {
    const items = reviewItems([
      photo("a", { importId: "import-a", selections: { top: selection("c1", "p1") } }),
      photo("b", { importId: "import-b", selections: { bottom: webSelection("c2", "https://shop/1") } }),
    ])
    expect(items.inventory.map((item) => item.selection.productId)).toEqual(["p1"])
    expect(items.web.map((item) => item.selection.listingUrl)).toEqual(["https://shop/1"])
    expect(items.total).toBe(2)
  })

  it("counts the same product picked on two photos once", () => {
    const items = reviewItems([
      photo("a", { selections: { top: selection("c1", "p1") } }),
      photo("b", { selections: { top: selection("c2", "p1") } }),
    ])
    expect(items.inventory).toHaveLength(1)
    expect(items.total).toBe(1)
  })

  it("counts the same listing picked on two photos once, keeping the first photo's import", () => {
    const items = reviewItems([
      photo("a", { importId: "import-a", selections: { top: webSelection("c1", "https://shop/1") } }),
      photo("b", { importId: "import-b", selections: { top: webSelection("c2", "https://shop/1") } }),
    ])
    expect(items.web).toHaveLength(1)
    expect(items.web[0].importId).toBe("import-a")
  })

  it("reads an empty batch as nothing selected", () => {
    expect(reviewItems([])).toEqual({ inventory: [], web: [], total: 0 })
  })
})

describe("stage moves", () => {
  it("opens review and returns to identify on the same photo", () => {
    const state = batchOf([photo("a"), photo("b")], { activePhotoId: "b" })
    const review = wardrobeBatchReducer(state, { type: "setStage", stage: "review" })
    expect(review.stage).toBe("review")
    expect(review.activePhotoId).toBe("b")

    const back = wardrobeBatchReducer(review, { type: "setStage", stage: "identify" })
    expect(back.stage).toBe("identify")
    expect(back.activePhotoId).toBe("b")
  })

  it("refuses review with no photos", () => {
    expect(wardrobeBatchReducer(emptyWardrobeBatch, { type: "setStage", stage: "review" }))
      .toBe(emptyWardrobeBatch)
  })
})
