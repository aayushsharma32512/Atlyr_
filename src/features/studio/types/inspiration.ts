import type { Outfit, OutfitItem } from "@/types"
import type { StudioRenderedItem } from "./renderedItem"

export type OutfitInspirationVariant = "wide" | "narrow"

export interface InspirationItem {
  id: string
  variant: OutfitInspirationVariant
  title?: string
  chips?: string[]
  outfitId?: string | null
  renderedItems?: StudioRenderedItem[]
  /**
   * Legacy fallback; avoid for new codepaths.
   */
  items?: OutfitItem[]
  avatarHeadSrc?: string
  attribution?: string
  showTitle?: boolean
  showChips?: boolean
  showSaveButton?: boolean
  isSaved?: boolean
  gender?: "male" | "female"
  heightCm?: number
  imageSrcFallback?: string
  outfit?: Outfit
}
