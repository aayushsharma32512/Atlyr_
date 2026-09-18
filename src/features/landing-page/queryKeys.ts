export const landingKeys = {
  all: ["landing"] as const,
  firstLook: () => [...landingKeys.all, "first-look"] as const,
  inventory: () => [...landingKeys.all, "inventory"] as const,
  search: (slot: string, query: string) => [...landingKeys.all, "search", slot, query] as const,
}
