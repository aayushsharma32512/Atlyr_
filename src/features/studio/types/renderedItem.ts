import type { MannequinSegmentName } from "./mannequin"

export type StudioRenderedZone = "top" | "bottom" | "shoes"

export interface StudioProductMetadata {
  id: string
  brand?: string | null
  productName?: string | null
  description?: string | null
  price?: number | null
  currency?: string | null
  size?: string | null
  color?: string | null
  colorGroup?: string | null
  gender?: "male" | "female" | "unisex" | null
  productUrl?: string | null
}

/**
 * Canvas+transform placement produced by the mesh editor / Modal placement engine, in the fixed
 * 1800x3072 placement-mannequin space. When present, the studio renders this item on the placement
 * mannequin via PlacementAvatarRenderer instead of the legacy cm/percent SVG path.
 */
export interface StudioPlacementTransform {
  scale: number
  rotationDeg: number
  tx: number
  ty: number
  warp: { x: number; y: number }[]
  mannequin: "male" | "female"
}

export interface StudioRenderedItem extends StudioProductMetadata {
  zone: StudioRenderedZone
  imageUrl: string
  placementX: number
  placementY: number
  imageLengthCm: number
  /** New canvas-transform placement; null on products not yet migrated (→ legacy SVG render). */
  placement?: StudioPlacementTransform | null
  bodyPartsVisible?: MannequinSegmentName[] | null
  extras?: Record<string, unknown> | null
}

export type ZoneVisibilityMap = Partial<Record<StudioRenderedZone, MannequinSegmentName[] | null>>

