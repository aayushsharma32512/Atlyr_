export const shareKeys = {
  all: ["share"] as const,
  link: (slug: string | null | undefined) => [...shareKeys.all, "link", slug ?? "none"] as const,
  create: ["share", "create"] as const,
}
