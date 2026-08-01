import { PlacementAvatarRenderer } from "@/features/studio/components/PlacementAvatarRenderer"
import { projectHexToTone } from "@/shared/skin/melanin"
import type { MannequinGender } from "@/features/profile/utils/mannequin"
import { cn } from "@/lib/utils"

/**
 * Head-and-shoulders preview of the user's avatar: the photoreal placement mannequin with their
 * hairstyle, hair colour and skin tone.
 *
 * This used to render the legacy SVG head, which meant onboarding previewed something that looked
 * nothing like what the studio actually draws — users picked a hairstyle against a flat cartoon head
 * and got a photoreal one. It also needed a page of camera maths to invert the SVG renderer's
 * layout and crop to the head; the placement renderer crops directly, so all of that is gone.
 */
export type HeadAvatarHairStyle = {
  /** Selects the baked photoreal cutout, e.g. 'bob'. */
  styleKey: string
  /** Which mannequin the cutout was baked against. */
  gender: MannequinGender
} | null

interface MannequinHeadAvatarProps {
  size: number
  gender: MannequinGender | null
  /** Stored as a hex on profiles.selected_skin_tone; projected onto the melanin axis to render. */
  skinToneHex: string | null
  hairStyle?: HeadAvatarHairStyle
  hairColorHex?: string | null
  className?: string
}

export function MannequinHeadAvatar({
  size,
  gender,
  skinToneHex,
  hairStyle = null,
  hairColorHex = null,
  className,
}: MannequinHeadAvatarProps) {
  const resolvedGender = gender ?? "female"

  return (
    <div
      className={cn("relative overflow-hidden rounded-full bg-muted/30", className)}
      style={{ width: size, height: size }}
      aria-label="Avatar preview"
    >
      <PlacementAvatarRenderer
        items={[]}
        gender={resolvedGender}
        containerWidth={size}
        containerHeight={size}
        crop="head"
        hairStyle={hairStyle}
        hairColorHex={hairColorHex}
        skinTone={skinToneHex ? projectHexToTone(skinToneHex) : null}
      />
    </div>
  )
}
