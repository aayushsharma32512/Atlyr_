import { describe, expect, it } from "@jest/globals"

import { detectionStatusFromImport, syncedDetectionStatus } from "@/features/wardrobe-import/importStatus"
import {
  MAX_WARDROBE_PHOTOS,
  emptyWardrobeBatch,
  wardrobeBatchReducer,
} from "@/features/wardrobe-import/wardrobeBatchReducer"
import type { WardrobeBatch, WardrobePhoto } from "@/features/wardrobe-import/types"

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
    ...overrides,
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
