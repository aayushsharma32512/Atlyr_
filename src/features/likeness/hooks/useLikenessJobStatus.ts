import { useMemo } from "react"

type AsyncStatus = "idle" | "pending" | "success" | "error"

interface JobStatusInput {
  uploadStatus: AsyncStatus
  selectStatus: AsyncStatus
  hasSavedPoses: boolean
}

export type LikenessJobState = "idle" | "processing" | "awaiting_review" | "saving" | "saved" | "error"

/**
 * The state machine itself — a pure function of its inputs, deliberately kept outside the
 * hook so it can be unit-tested without a React renderer.
 *
 * Calling the hook directly from a test throws "null is not an object (evaluating
 * 'dispatcher.useMemo')", because useMemo needs an active dispatcher. Testing it through
 * the hook would mean pulling in @testing-library/react purely to exercise six branches
 * that touch no React state.
 */
export function deriveLikenessJobState({
  uploadStatus,
  selectStatus,
  hasSavedPoses,
}: JobStatusInput): LikenessJobState {
  if (uploadStatus === "pending") {
    return "processing"
  }
  if (uploadStatus === "error" || selectStatus === "error") {
    return "error"
  }
  if (selectStatus === "pending") {
    return "saving"
  }
  if (uploadStatus === "success" && selectStatus === "idle") {
    return "awaiting_review"
  }
  if (hasSavedPoses) {
    return "saved"
  }
  return "idle"
}

export function useLikenessJobStatus({ uploadStatus, selectStatus, hasSavedPoses }: JobStatusInput): LikenessJobState {
  return useMemo(
    () => deriveLikenessJobState({ uploadStatus, selectStatus, hasSavedPoses }),
    [uploadStatus, selectStatus, hasSavedPoses]
  )
}
