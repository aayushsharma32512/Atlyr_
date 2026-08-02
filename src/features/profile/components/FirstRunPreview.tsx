import type { ReactNode } from "react"

import { WordmarkLockup } from "@/design-system/primitives"
import { PlacementAvatarRenderer } from "@/features/studio/components/PlacementAvatarRenderer"
import type { HeadAvatarHairStyle } from "@/features/profile/components/MannequinHeadAvatar"
import type { MannequinGender } from "@/features/profile/utils/mannequin"
import { useElementSize } from "@/shared/hooks/useElementSize"
import { projectHexToTone } from "@/shared/skin/melanin"
import { cn } from "@/lib/utils"

/**
 * First run's preview surfaces.
 *
 * The screens were built from a 390px frame, so on a desktop the form sat in a
 * 720px column with ~1200px of empty ground beside it. The figure is what that
 * space is for: it was already being rendered, as a 64px circle buried at the
 * bottom of the scroll, which is the one element that most justifies the width
 * and the one hardest to see.
 *
 * Only ever mount ONE of these per screen — PlacementAvatarRenderer starts a
 * PIXI Application, so the desktop pane and the phone strip are switched in JS
 * (useIsMobile(1024)), never with `hidden lg:block`.
 */

/** The cloth ground the gate and login already use. Hosts either preview. */
export function FirstRunPane({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    // No `hidden lg:block` here on purpose — the caller decides whether this
    // mounts at all, because hiding it in CSS would still start the renderer.
    <aside
      // flex-1, not a fixed width: the form column is capped at its measure, so
      // anything the pane doesn't take becomes dead ground between the two.
      className={cn(
        "relative h-[100dvh] min-w-[300px] flex-1 overflow-hidden border-l border-hairline bg-background",
        className,
      )}
    >
      <div className="bg-warp-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-10 py-12">
        {children}
      </div>
    </aside>
  )
}

/**
 * Brand ground: shown on the taste step, and on the figure step until a figure
 * has actually been chosen. Standing in with a defaulted body would pre-empt
 * the one decision the screen is asking for.
 */
export function FirstRunBrandGround({ caption }: { caption: string }) {
  return (
    <>
      <WordmarkLockup size="landing" />
      <p className="mt-8 max-w-[34ch] text-center text-fluid-lg leading-[1.6] text-muted-foreground">
        {caption}
      </p>
    </>
  )
}

export interface FirstRunFigureProps {
  gender: MannequinGender | null
  /** Stored as a hex on profiles.selected_skin_tone; projected onto the melanin axis to render. */
  skinToneHex: string | null
  hairStyle?: HeadAvatarHairStyle
  hairColorHex?: string | null
  /**
   * `figure` for the desktop pane, `head` for the phone strip — a ~100px band
   * at the mannequin's 1800x3072 aspect would be about 59px wide, which is the
   * case the renderer's own `head` crop exists for.
   */
  crop?: "figure" | "head"
  className?: string
}

/**
 * Live mannequin, sized from its own box. The renderer is a PIXI surface taking
 * numeric dimensions, so the host is measured rather than sized in CSS.
 */
export function FirstRunFigure({
  gender,
  skinToneHex,
  hairStyle = null,
  hairColorHex = null,
  crop = "figure",
  className,
}: FirstRunFigureProps) {
  const [hostRef, { width, height }] = useElementSize<HTMLDivElement>()

  return (
    <div ref={hostRef} className={cn("relative h-full w-full", className)} aria-label="Figure preview">
      {width > 0 && height > 0 && (
        <PlacementAvatarRenderer
          items={[]}
          gender={gender ?? "female"}
          containerWidth={width}
          containerHeight={height}
          crop={crop}
          hairStyle={hairStyle}
          hairColorHex={hairColorHex}
          skinTone={skinToneHex ? projectHexToTone(skinToneHex) : null}
        />
      )}
    </div>
  )
}
