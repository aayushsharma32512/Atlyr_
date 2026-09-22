export const notificationsKeys = {
  all: ["notifications"] as const,
  list: (userId: string | null) => [...notificationsKeys.all, "list", userId ?? "anonymous"] as const,
}
