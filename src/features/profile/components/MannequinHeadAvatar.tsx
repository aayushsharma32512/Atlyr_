import { useMemo } from "react"

import { AvatarRenderer } from "@/features/studio/components/AvatarRenderer"
import { useMannequinConfig } from "@/features/studio/hooks/useMannequinConfig"
import { DEFAULT_MANNEQUIN_BODY_TYPE, type MannequinGender } from "@/features/profile/utils/mannequin"
import { HEAD_CHIN_OFFSET_RATIO, HEAD_LENGTH_RATIO, getSegmentLengthPx } from "@/features/studio/utils/avatarMath"
import { cn } from "@/lib/utils"

type HairStyleConfig = {
  assetUrl: string
  lengthPct: number
  yOffsetPct: number
  xOffsetPct: number
  zIndex: number
} | null

interface MannequinHeadAvatarProps {
  size: number
  gender: MannequinGender | null
  skinToneHex: string | null
  hairStyle?: HairStyleConfig
  hairColorHex?: string | null
  className?: string
}

const INTERNAL_CANVAS_HEIGHT = 240
const INTERNAL_CANVAS_WIDTH = 240

export function MannequinHeadAvatar({
  size,
  gender,
  skinToneHex,
  hairStyle = null,
  hairColorHex = null,
  className,
}: MannequinHeadAvatarProps) {
  const mannequinQuery = useMannequinConfig({
    gender,
    bodyType: DEFAULT_MANNEQUIN_BODY_TYPE,
    enabled: Boolean(gender),
  })

  const camera = useMemo(() => {
    const containerHeight = INTERNAL_CANVAS_HEIGHT
    const containerWidth = INTERNAL_CANVAS_WIDTH

    // AvatarRenderer's userHeightPx converges to roughly:
    // userHeightPx = containerHeight - chinOffsetPx
    // chinOffsetPx = headHeightPx * (1 - HEAD_CHIN_OFFSET_RATIO)
    // headHeightPx = userHeightPx * HEAD_LENGTH_RATIO
    // => userHeightPx * (1 + HEAD_LENGTH_RATIO*(1-HEAD_CHIN_OFFSET_RATIO)) = containerHeight
    const denom = 1 + HEAD_LENGTH_RATIO * (1 - HEAD_CHIN_OFFSET_RATIO)
    const userHeightPx = denom > 0 ? containerHeight / denom : containerHeight
    const headHeightPx = userHeightPx * HEAD_LENGTH_RATIO
    const chinOffsetPx = headHeightPx * (1 - HEAD_CHIN_OFFSET_RATIO)

    const rawHairTopPx =
      hairStyle ? chinOffsetPx + (hairStyle.yOffsetPct / 100) * userHeightPx : null
    const hairLengthPx = hairStyle ? getSegmentLengthPx(hairStyle.lengthPct, userHeightPx) : null

    const globalTopOffsetPx =
      rawHairTopPx != null && Number.isFinite(rawHairTopPx) && rawHairTopPx < 0
        ? Math.ceil(-rawHairTopPx) + 1
        : 0

    const hairTopPx = rawHairTopPx != null ? rawHairTopPx + globalTopOffsetPx : null
    const headTopPx = globalTopOffsetPx
    const focusBottom =
      hairTopPx != null && hairLengthPx != null
        ? Math.max(headTopPx + headHeightPx, hairTopPx + hairLengthPx)
        : headTopPx + headHeightPx
    const focusHeight = Math.max(1, focusBottom)

    const scale = size / focusHeight
    const centerX = containerWidth / 2
    const centerY = focusHeight / 2

    const left = size / 2 - centerX * scale
    const top = size / 2 - centerY * scale

    return {
      containerHeight,
      containerWidth,
      scale,
      left,
      top,
    }
  }, [hairStyle, size])

  if (!mannequinQuery.data) {
    return (
      <div
        className={cn("h-full w-full rounded-full bg-muted", className)}
        style={{ width: size, height: size }}
        aria-label="Avatar preview"
      />
    )
  }

  return (
    <div
      className={cn("relative overflow-hidden rounded-full bg-transparent", className)}
      style={{ width: size, height: size }}
      aria-label="Avatar preview"
    >
      <div
        className="absolute"
        style={{
          width: camera.containerWidth,
          height: camera.containerHeight,
          left: camera.left,
          top: camera.top,
          transform: `scale(${camera.scale})`,
          transformOrigin: "top left",
        }}
      >
        <AvatarRenderer
          mannequinConfig={mannequinQuery.data}
          items={[]}
          containerHeight={camera.containerHeight}
          containerWidth={camera.containerWidth}
          gender={gender ?? "male"}
          skinToneHex={skinToneHex}
          hairStyle={hairStyle}
          hairColorHex={hairColorHex}
          visibleSegments={["head"]}
          showBody={false}
        />
      </div>
    </div>
  )
}
