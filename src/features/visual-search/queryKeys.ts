export const visualSearchKeys = {
  all: ["visual-search-test"] as const,
  run: () => [...visualSearchKeys.all, "run"] as const,
  searchOnline: () => [...visualSearchKeys.all, "search-online"] as const,
}
