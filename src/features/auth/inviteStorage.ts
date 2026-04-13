const RETURNING_MARKER_KEY = "atlyr_returning_v1"
const PENDING_INVITE_KEY = "atlyr_pending_invite_code_v1"

export function setReturningMarker() {
  try {
    localStorage.setItem(RETURNING_MARKER_KEY, "1")
  } catch {
    // ignore storage failures
  }
}

export function hasReturningMarker(): boolean {
  try {
    return localStorage.getItem(RETURNING_MARKER_KEY) === "1"
  } catch {
    return false
  }
}

export function clearReturningMarker() {
  try {
    localStorage.removeItem(RETURNING_MARKER_KEY)
  } catch {
    // ignore storage failures
  }
}

export function setPendingInviteCode(code: string) {
  const trimmed = code.trim()
  if (!trimmed) return
  try {
    localStorage.setItem(PENDING_INVITE_KEY, trimmed)
  } catch {
    // ignore storage failures
  }
}

export function getPendingInviteCode(): string | null {
  try {
    return localStorage.getItem(PENDING_INVITE_KEY)
  } catch {
    return null
  }
}

export function clearPendingInviteCode() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY)
  } catch {
    // ignore storage failures
  }
}

