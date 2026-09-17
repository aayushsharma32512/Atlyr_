const INVALID_TAGS = new Set(["null", "nan"])

/** Splits a comma-joined DB column into clean tags, dropping empty/"null"/"nan" entries. */
export function splitTagList(value?: string | null): string[] {
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !INVALID_TAGS.has(entry.toLowerCase()))
}

/** Case-insensitive dedupe that keeps first-seen casing and order. */
export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  return result
}

export type ProductTagSource = {
  fit?: string | null
  feel?: string | null
  vibes?: string | null
  color_group?: string | null
  material_type?: string | null
} | null | undefined

/** A product's derived tags: fit + feel + vibes + color_group + material_type, deduped. */
export function getProductTags(product: ProductTagSource): string[] {
  if (!product) {
    return []
  }

  return dedupeTags([
    ...splitTagList(product.fit),
    ...splitTagList(product.feel),
    ...splitTagList(product.vibes),
    ...splitTagList(product.color_group),
    ...splitTagList(product.material_type),
  ])
}

export type TrayItemTagSource = {
  fitTags: string[]
  feelTags: string[]
  vibeTags: string[]
  colorGroup?: string | null
  materialType?: string | null
} | null | undefined

/** Same derived-tags order as `getProductTags`, from an already-parsed tray item. */
export function getTrayItemTags(item: TrayItemTagSource): string[] {
  if (!item) {
    return []
  }

  return dedupeTags([
    ...item.fitTags,
    ...item.feelTags,
    ...item.vibeTags,
    ...splitTagList(item.colorGroup),
    ...splitTagList(item.materialType),
  ])
}

type OutfitTagItem = ProductTagSource | TrayItemTagSource

function hasTrayTagArrays(item: OutfitTagItem): item is NonNullable<TrayItemTagSource> {
  return Boolean(item) && Array.isArray((item as { fitTags?: unknown }).fitTags)
}

/**
 * An outfit's derived tags: each composite product's tags, in item order, deduped.
 * Accepts either a raw product-shaped item (fit/feel/vibes as strings, e.g. a legacy
 * outfit item) or an already-parsed tray item (fitTags/feelTags/vibeTags as arrays).
 */
export function getOutfitTagsFromItems(items: OutfitTagItem[]): string[] {
  return dedupeTags(
    items.flatMap((item) => (hasTrayTagArrays(item) ? getTrayItemTags(item) : getProductTags(item))),
  )
}
