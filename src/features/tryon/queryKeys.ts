export const tryOnKeys = {
  all: ["tryon"] as const,
  ensure: (productId: string) => [...tryOnKeys.all, "ensure", productId] as const,
  ensureSummaries: () => [...tryOnKeys.all, "ensure-summaries"] as const,
  generate: () => [...tryOnKeys.all, "generate"] as const,
  generation: (generationId: string) => [...tryOnKeys.all, "generation", generationId] as const,
  generationStatus: (generationId: string | null) =>
    generationId ? tryOnKeys.generation(generationId) : [...tryOnKeys.all, "generation", "noop"] as const,
  list: () => [...tryOnKeys.all, "list"] as const,
}
