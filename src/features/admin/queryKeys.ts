export const adminKeys = {
  all: ["admin"] as const,
  issueInvites: () => [...adminKeys.all, "issue-invites"] as const,
}
