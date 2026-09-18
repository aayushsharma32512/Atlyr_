export const landingKeys = {
  all: ["landing"] as const,
  firstLook: () => [...landingKeys.all, "first-look"] as const,
  inventory: () => [...landingKeys.all, "inventory"] as const,
  search: (slot: string, query: string, imageUrl: string | null) =>
    [...landingKeys.all, "search", slot, query, imageUrl] as const,
}
