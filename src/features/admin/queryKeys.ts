export type WaitlistTab = "pending" | "approved"

export const adminKeys = {
  all: ["admin"] as const,
  issueInvites: () => [...adminKeys.all, "issue-invites"] as const,
  waitlist: () => [...adminKeys.all, "waitlist"] as const,
  waitlistTab: (tab: WaitlistTab) => [...adminKeys.waitlist(), tab] as const,
}
