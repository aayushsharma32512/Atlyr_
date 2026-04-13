import { useMemo } from "react"

type AsyncStatus = "idle" | "pending" | "success" | "error"

interface JobStatusInput {
  uploadStatus: AsyncStatus
  selectStatus: AsyncStatus
  hasSavedPoses: boolean
}

export type LikenessJobState = "idle" | "processing" | "awaiting_review" | "saving" | "saved" | "error"

export function useLikenessJobStatus({ uploadStatus, selectStatus, hasSavedPoses }: JobStatusInput): LikenessJobState {
  return useMemo(() => {
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
  }, [uploadStatus, selectStatus, hasSavedPoses])
}


