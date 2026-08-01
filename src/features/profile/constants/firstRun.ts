/**
 * First run currently has ONE step: the figure (canvas 6c2).
 *
 * Taste (6c) is built and reachable at TASTE_PATH, but is deliberately out of
 * the flow for now — it has nowhere to save picks, and the handoff's own
 * position is that a half-built taste step is debt ("no cosmetic client-side
 * stub"). To put it back in front of the figure, point FIRST_RUN_ENTRY_PATH at
 * TASTE_PATH; the page already links onward to the figure step.
 *
 * Every first-run path is exempt from the onboarding redirect, otherwise the
 * gate would bounce the user out of the screen it just sent them to.
 */
export const TASTE_PATH = "/onboarding/taste"
export const FIRST_RUN_FIGURE_PATH = "/profile/user-details"
export const FIRST_RUN_ENTRY_PATH = FIRST_RUN_FIGURE_PATH

const FIRST_RUN_PATHS = [TASTE_PATH, FIRST_RUN_FIGURE_PATH]

/**
 * Whether the taste step precedes the figure. Drives the step counter on 6c2 so
 * it can't claim "step 2 of 2" while being the only screen in the flow.
 */
export const TASTE_IN_FIRST_RUN: boolean = FIRST_RUN_ENTRY_PATH === TASTE_PATH

export function isFirstRunPath(pathname: string): boolean {
  return FIRST_RUN_PATHS.some((path) => pathname.startsWith(path))
}

/**
 * `onboarding_complete` is nullable, and a missing profile means a brand new
 * user. Both are treated as "not done" — previously AppShellLayout checked
 * `=== false` (so null slipped through) while Index.tsx checked falsy, and the
 * two disagreed for exactly the users who had never saved the step.
 */
export function needsFirstRun(
  profile: { onboarding_complete?: boolean | null } | null | undefined,
): boolean {
  return !profile || !profile.onboarding_complete
}
