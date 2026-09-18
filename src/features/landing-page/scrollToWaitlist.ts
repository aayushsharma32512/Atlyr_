export const WAITLIST_FORM_ID = "waitlist-form"

export function scrollToWaitlist() {
  document.getElementById(WAITLIST_FORM_ID)?.scrollIntoView({ behavior: "smooth", block: "start" })
}
