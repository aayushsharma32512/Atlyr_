export function resolveOutfitAttribution(createdBy?: string | null): string | undefined {
  if (!createdBy) return undefined
  const trimmed = createdBy.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
