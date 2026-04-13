import { describe, expect, it } from "@jest/globals"

import { useLikenessJobStatus, type LikenessJobState } from "../useLikenessJobStatus"

describe("useLikenessJobStatus", () => {
  const cases: Array<{
    uploadStatus: "idle" | "pending" | "success" | "error"
    selectStatus: "idle" | "pending" | "success" | "error"
    hasSavedPoses: boolean
    expected: LikenessJobState
  }> = [
    { uploadStatus: "pending", selectStatus: "idle", hasSavedPoses: false, expected: "processing" },
    { uploadStatus: "error", selectStatus: "idle", hasSavedPoses: false, expected: "error" },
    { uploadStatus: "success", selectStatus: "pending", hasSavedPoses: false, expected: "saving" },
    { uploadStatus: "success", selectStatus: "idle", hasSavedPoses: false, expected: "awaiting_review" },
    { uploadStatus: "success", selectStatus: "success", hasSavedPoses: true, expected: "saved" },
    { uploadStatus: "idle", selectStatus: "idle", hasSavedPoses: false, expected: "idle" },
  ]

  cases.forEach(({ uploadStatus, selectStatus, hasSavedPoses, expected }) => {
    it(`returns ${expected} for upload=${uploadStatus}, select=${selectStatus}, saved=${hasSavedPoses}`, () => {
      const state = useLikenessJobStatus({ uploadStatus, selectStatus, hasSavedPoses })
      expect(state).toBe(expected)
    })
  })
})


