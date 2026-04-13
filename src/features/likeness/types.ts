export interface LikenessFormData {
  // Step 1: New User Form 1
  fullBodyPhoto?: File | null
  faceSelfiePhoto?: File | null

  // Step 2: New User Form 2
  selectedAvatars?: string[]

  // Step 3: Regular Form
  selectedBaseAvatar?: string
  generateNew?: boolean
}

export type LikenessStep = 1 | 2 | 3

export interface LikenessOutfitItemsParam {
  topId?: string | null
  bottomId?: string | null
  footwearId?: string | null
}

export interface LikenessOutfitSnapshotParam {
  id?: string
  name?: string | null
  category?: string | null
  occasionId?: string | null
  backgroundId?: string | null
  gender?: "male" | "female" | "unisex" | null
}

export interface LikenessDrawerOpenDetail {
  initialStep?: LikenessStep
  batchId?: string | null
  outfitItems?: LikenessOutfitItemsParam
  outfitSnapshot?: LikenessOutfitSnapshotParam
  entrySource?: "direct" | "fromProgressHub" | "fromStep3"
  savedMode?: boolean
  savedPoseId?: string | null
}


