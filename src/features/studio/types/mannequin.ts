export type MannequinSegmentName =
  | "head"
  | "neck"
  | "torso"
  | "arm_left"
  | "arm_right"
  | "legs"
  | "feet"

export interface MannequinSegmentConfig {
  name: MannequinSegmentName
  assetUrl: string
  lengthPct: number
  placementYPct: number
  zIndex: number
  xOffsetPct?: number
}

export interface MannequinConfig {
  id: string
  gender: "male" | "female"
  bodyType: string
  heightCm: number
  defaultScale: number
  segments: Record<MannequinSegmentName, MannequinSegmentConfig>
  createdAt?: string
  updatedAt?: string
}

export interface SegmentDimensions {
  width: number
  height: number
}

