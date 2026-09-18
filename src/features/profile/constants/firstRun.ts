/**
 * First run is two screens: about you (name, photo, age, height, figure,
 * size), then the figure (skin tone and hair on a default mannequin, skippable).
 *
 * Taste is built and reachable at TASTE_PATH but out of the flow — it has
 * nowhere to save picks yet.
 *
 * Every first-run path is exempt from the onboarding redirect, otherwise the
 * gate would bounce the user out of the screen it just sent them to.
 */
export const TASTE_PATH = "/onboarding/taste"
export const ONBOARDING_ABOUT_PATH = "/onboarding/about"
export const ONBOARDING_FIGURE_PATH = "/onboarding/figure"

export const FIRST_RUN_ENTRY_PATH: string = ONBOARDING_ABOUT_PATH

const FIRST_RUN_PATHS = [TASTE_PATH, ONBOARDING_ABOUT_PATH, ONBOARDING_FIGURE_PATH]

/** Taste no longer precedes the figure; kept so the legacy figure editor's eyebrow still compiles. */
export const TASTE_IN_FIRST_RUN: boolean = FIRST_RUN_ENTRY_PATH === TASTE_PATH

export function isFirstRunPath(pathname: string): boolean {
  return FIRST_RUN_PATHS.some((path) => pathname.startsWith(path))
}

/** Nullable flag and a missing row both mean "not done" — a brand new user has no profile row yet. */
export function needsFirstRun(
  profile: { onboarding_complete?: boolean | null } | null | undefined,
): boolean {
  return !profile || !profile.onboarding_complete
}
