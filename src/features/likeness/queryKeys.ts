export const likenessKeys = {
  all: ["likeness"] as const,
  list: () => [...likenessKeys.all, "list"] as const,
  upload: () => [...likenessKeys.all, "upload"] as const,
  setActive: () => [...likenessKeys.all, "set-active"] as const,
  select: () => [...likenessKeys.all, "select"] as const,
  delete: () => [...likenessKeys.all, "delete"] as const,
  candidates: (batchId: string) => [...likenessKeys.all, "candidates", batchId] as const,
  candidatesStatus: (batchId: string | null) =>
    batchId ? likenessKeys.candidates(batchId) : [...likenessKeys.all, "candidates", "noop"] as const,
  detail: (poseId: string) => [...likenessKeys.all, "detail", poseId] as const,
  jobs: () => [...likenessKeys.all, "jobs"] as const,
}

