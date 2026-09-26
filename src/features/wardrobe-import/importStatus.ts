import type { WardrobeDetectionStatus } from "./types"

/** Maps an import row's status onto the five states a photo tile can show. */
export function detectionStatusFromImport(status: string): WardrobeDetectionStatus {
  if (status === "failed" || status === "expired") return "failed"
  if (status === "created" || status === "source_ready" || status === "detecting") return "detecting"
  return "complete"
}

/**
 * A start that threw stays failed until the user retries, even when the row never
 * left source_ready — otherwise the tile spins for ever.
 */
export function syncedDetectionStatus(
  current: WardrobeDetectionStatus,
  rowStatus: string,
): WardrobeDetectionStatus {
  const next = detectionStatusFromImport(rowStatus)
  return next === "detecting" && current === "failed" ? "failed" : next
}
