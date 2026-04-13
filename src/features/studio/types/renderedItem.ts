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

export interface StudioRenderedItem extends StudioProductMetadata {
  zone: StudioRenderedZone
  imageUrl: string
  placementX: number
  placementY: number
  imageLengthCm: number
  bodyPartsVisible?: MannequinSegmentName[] | null
  extras?: Record<string, unknown> | null
}

export type ZoneVisibilityMap = Partial<Record<StudioRenderedZone, MannequinSegmentName[] | null>>

