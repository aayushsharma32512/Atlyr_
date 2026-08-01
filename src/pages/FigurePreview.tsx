import { UserDetailsPage } from "@/features/profile/pages/UserDetailsPage"

/**
 * /design-system/figure — the figure step (canvas 6c2) as first run always
 * renders it: wordmark, step eyebrow, headline, and the skip affordance.
 *
 * The live route at /profile/user-details swaps to edit chrome once
 * `onboarding_complete` is set, so an onboarded account can never see the
 * designed version there. This route pins it. Designed at a 390×844 frame.
 */
export default function FigurePreview() {
  return <UserDetailsPage forceFirstRunChrome />
}
