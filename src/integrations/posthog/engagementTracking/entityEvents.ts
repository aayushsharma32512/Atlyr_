import type { EngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"

export type EntityType = "outfit" | "product"
export type Layout = "vertical_grid" | "horizontal_rail" | "carousel"
export type SaveMethod = "click" | "long_press"

export type EntityUiContext = {
  layout?: Layout
  position?: number
  section?: string
  rail_id?: string
}

export function slugifyUiLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function buildRailId(surface: string, label: string): string {
  return `${surface}:${slugifyUiLabel(label)}`
}

// Visual ordering B1 for column-bucketed “vertical grids”: traverse row-major across columns.
export function computeBucketedRowMajorPositions(
  ids: string[],
  columnCount: number,
): Map<string, number> {
  const safeColumns = Math.max(1, Math.floor(columnCount))
  const buckets: string[][] = Array.from({ length: safeColumns }, () => [])
  ids.forEach((id, index) => {
    buckets[index % safeColumns].push(id)
  })

  const maxRows = Math.max(0, ...buckets.map((b) => b.length))
  const positions = new Map<string, number>()
  let pos = 0

  for (let row = 0; row < maxRows; row += 1) {
    for (let col = 0; col < safeColumns; col += 1) {
      const id = buckets[col]?.[row]
      if (!id) continue
      if (positions.has(id)) continue
      positions.set(id, pos)
      pos += 1
    }
  }

  return positions
}

export function trackItemClicked(
  analytics: EngagementAnalytics,
  args: { entity_type: EntityType; entity_id: string } & EntityUiContext,
) {
  analytics.capture("item_clicked", args as unknown as Record<string, unknown>)
}

export function trackSaveToggled(
  analytics: EngagementAnalytics,
  args: { entity_type: EntityType; entity_id: string; new_state: boolean; save_method: SaveMethod } & EntityUiContext,
) {
  analytics.capture("save_toggled", args as unknown as Record<string, unknown>)
}

export function trackSavedToCollection(
  analytics: EngagementAnalytics,
  args: { entity_type: EntityType; entity_id: string; collection_slug: string; save_method: SaveMethod } & EntityUiContext,
) {
  analytics.capture("saved_to_collection", args as unknown as Record<string, unknown>)
}

export function trackProductBuyClicked(
  analytics: EngagementAnalytics,
  args: { entity_id: string } & EntityUiContext,
) {
  analytics.capture("product_buy_clicked", {
    entity_type: "product",
    ...args,
  } as unknown as Record<string, unknown>)
}

