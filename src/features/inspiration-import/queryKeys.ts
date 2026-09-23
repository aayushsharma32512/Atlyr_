export const inspirationImportKeys = {
  all: ["inspiration-imports"] as const,
  webRequests: () => [...inspirationImportKeys.all, "admin", "web-requests"] as const,
  myWardrobeWebRequests: (userId: string | null) =>
    [...inspirationImportKeys.all, "mine", "wardrobe-web-requests", userId ?? "anonymous"] as const,
  detail: (importId: string) => [...inspirationImportKeys.all, "detail", importId] as const,
  catalogue: (
    importId: string,
    candidateId: string,
    category: "top" | "bottom",
    gender: "male" | "female" | null,
  ) => [
    ...inspirationImportKeys.all,
    "catalogue",
    importId,
    candidateId,
    category,
    gender ?? "all-genders",
  ] as const,
  web: (importId: string, candidateId: string) => [
    ...inspirationImportKeys.all,
    "web",
    importId,
    candidateId,
  ] as const,
}
