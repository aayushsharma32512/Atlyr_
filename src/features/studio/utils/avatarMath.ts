import type { SegmentDimensions } from "@/features/studio/types"

export const HEAD_CHIN_OFFSET_RATIO = 0.0945
export const HEAD_LENGTH_RATIO = 0.1515
export const HEAD_TO_BODY_RATIO = 1.0

export const DEFAULT_USER_HEIGHT_CM: Record<"male" | "female", number> = {
  male: 175,
  female: 163,
}

export interface HeadScaleResult {
  scaledHead: SegmentDimensions
  headScale: number
  chinOffsetPx: number
}

export function getPxPerCm(userHeightPx: number, userHeightCm: number): number {
  if (userHeightCm <= 0) {
    return 0
  }
  return userHeightPx / userHeightCm
}

export function computeHeadScale(
  headDimensions: SegmentDimensions,
  userHeightCm: number,
  pxPerCm: number,
): HeadScaleResult {
  const headLengthCm = userHeightCm * HEAD_LENGTH_RATIO
  const desiredHeadHeightPx = pxPerCm * headLengthCm * HEAD_TO_BODY_RATIO
  const headScale = headDimensions.height > 0 ? desiredHeadHeightPx / headDimensions.height : 1
  const scaledHead = {
    width: headDimensions.width * headScale,
    height: headDimensions.height * headScale,
  }
  const chinOffsetPx = scaledHead.height * (1 - HEAD_CHIN_OFFSET_RATIO)
  return { scaledHead, headScale, chinOffsetPx }
}

export function getSegmentLengthPx(lengthPct: number, userHeightPx: number): number {
  return (lengthPct / 100) * userHeightPx
}

