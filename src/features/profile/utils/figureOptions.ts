import type { DropdownOption } from "@/features/profile/components/DropdownSelector"
import type { PickTile } from "@/features/profile/components/PickRow"
import type { MannequinGender } from "@/features/profile/utils/mannequin"
import {
  PLACEMENT_CANVAS_WIDTH,
  headCropRect,
} from "@/features/studio/constants/mannequinAnchors"
import type { AvatarHairStyleRecord } from "@/services/profile/avatarHairStylesService"
import { SKIN_TONE_STEPS, skinToneChipColor } from "@/shared/skin/melanin"

/** Option builders shared by the first-run figure step and the profile figure editor. */

export const HAIR_COLOR_SWATCHES = [
  "#000000",
  "#2B1B12",
  "#4A2F1B",
  "#6B3F2A",
  "#8A5A3A",
  "#A67C52",
  "#C8A165",
  "#D9B382",
  "#E6C79C",
  "#FFFFFF",
]

export const HAIR_COLOR_OPTIONS: PickTile[] = HAIR_COLOR_SWATCHES.map((hex) => ({
  id: hex,
  label: "",
  description: `Hair colour ${hex}`,
  color: hex,
}))

/**
 * Swatches show the mannequin's own skin retoned, not the raw reference colour,
 * so the chip you pick looks like the body you get. The stored id stays the
 * reference hex because that is what the renderer's projection is calibrated on.
 */
export function buildSkinToneOptions(gender: MannequinGender | null): PickTile[] {
  if (!gender) return []
  return SKIN_TONE_STEPS.map((step, index) => ({
    id: step.hex,
    label: String(index + 1).padStart(2, "0"),
    description: step.label,
    color: skinToneChipColor(gender, step.tone),
  }))
}

/**
 * Thumbnails come from the baked photoreal cutouts in /public/hair-baked, not
 * from the flat compositing layer in `assetUrl`, cropped to the head with the
 * renderer's own rect.
 */
export function buildHairOptions(
  gender: MannequinGender | null,
  styles: AvatarHairStyleRecord[],
): PickTile[] {
  if (!gender) return []
  const rect = headCropRect(gender)
  const crop = { x: rect.x, y: rect.y, w: rect.w, naturalWidth: PLACEMENT_CANVAS_WIDTH }
  return styles.map((style) => ({
    id: style.id,
    label: style.styleKey,
    imageUrl: `/hair-baked/${gender}/${style.styleKey}.webp`,
    imageCrop: crop,
  }))
}

export function buildHeightOptions(): DropdownOption[] {
  const options: DropdownOption[] = []
  for (let feet = 4; feet <= 7; feet += 1) {
    const maxInches = feet === 7 ? 0 : 11
    for (let inches = 0; inches <= maxInches; inches += 1) {
      const totalInches = feet * 12 + inches
      const cm = Math.round(totalInches * 2.54)
      const label = `${feet}'${inches}" (${cm} cm)`
      options.push({ id: `${cm}`, label, value: label })
    }
  }
  return options
}
