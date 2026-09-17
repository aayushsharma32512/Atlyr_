// Codes are stored uppercase; legacy ones contain underscores, new ones dashes.
const CODE_PATTERN = /^[A-Z0-9_-]{4,24}$/

export function normalizeInviteCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase()
  return CODE_PATTERN.test(code) ? code : null
}

// Fixed, user-facing text per server error code; never surfaces raw server messages.
const ERROR_TEXT: Record<string, string> = {
  INVITE_NOT_FOUND: "That code isn't valid.",
  INVITE_INACTIVE: "That code is no longer active.",
  INVITE_EXPIRED: "That code has expired.",
  INVITE_MAXED_OUT: "That code has already been used.",
  INVITE_REQUIRED: "Enter your invite code.",
  INVITE_INVALID_FORMAT: "That doesn't look like an invite code.",
}

export function inviteErrorText(code: string | undefined | null): string {
  return (code && ERROR_TEXT[code]) || "Something went wrong. Please try again."
}
