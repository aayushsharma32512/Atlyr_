export const visualSearchKeys = {
  all: ["visual-search-test"] as const,
  run: () => [...visualSearchKeys.all, "run"] as const,
}
