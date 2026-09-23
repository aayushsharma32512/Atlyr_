/** The garment slots the wardrobe flow handles. Footwear becomes one more member here. */
export type WardrobePieceType = "top" | "bottom"

export const WARDROBE_PIECE_TYPES: readonly WardrobePieceType[] = ["top", "bottom"]

export type WardrobeDetectionStatus =
  | "pending"
  | "uploading"
  | "detecting"
  | "complete"
  | "failed"

export type WardrobePhotoStep = "pieces" | "matches"

export type WardrobeRailSource = "inventory" | "web"

export type WardrobePieceSelection = {
  source: WardrobeRailSource
  productId?: string
  listingUrl?: string
  title: string
  imageUrl: string
  brand?: string
  priceLabel?: string
  selectionToken?: string
  candidateId: string
  /** Set once the pick has been sent on — to the wardrobe board, or to the Atlyr team. */
  committedAt?: number
}

/** Inventory and web each keep their own pick of one piece; one never replaces the other. */
export type WardrobePiecePicks = Partial<Record<WardrobeRailSource, WardrobePieceSelection>>

/** Names one pick of one photo: which piece it dresses, and which rail it came from. */
export type WardrobePieceRef = {
  type: WardrobePieceType
  source: WardrobeRailSource
}

export type WardrobePhoto = {
  id: string
  importId: string | null
  /** Absent once the batch is rebuilt from storage: the image then comes from the import row. */
  file?: File
  previewUrl: string
  detectionStatus: WardrobeDetectionStatus
  confirmedPieceIds: string[]
  /** Stops the detector's default pick from overriding a user who cleared every piece. */
  piecesDefaulted: boolean
  step: WardrobePhotoStep
  selections: Partial<Record<WardrobePieceType, WardrobePiecePicks>>
  /** Which rail each piece was last looking at, keyed by candidate id. */
  railByPiece: Partial<Record<string, WardrobeRailSource>>
}

export type WardrobeBatch = {
  stage: "add" | "identify"
  photos: WardrobePhoto[]
  activePhotoId: string | null
}
