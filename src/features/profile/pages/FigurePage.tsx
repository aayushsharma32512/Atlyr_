import { useMemo, useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { FirstRunFigure } from "@/features/profile/components/FirstRunPreview"
import { FirstRunShell } from "@/features/profile/components/FirstRunShell"
import { REVEAL_CLASS, revealDelay, useIsFirstRunCompact } from "@/features/profile/components/firstRunLayout"
import type { HeadAvatarHairStyle } from "@/features/profile/components/MannequinHeadAvatar"
import { PickRow } from "@/features/profile/components/PickRow"
import { ONBOARDING_ABOUT_PATH } from "@/features/profile/constants/firstRun"
import { PROFILE_DETAILS_PATH, PROFILE_PATH } from "@/features/profile/constants/profilePaths"
import type { ProfileStepMode } from "@/features/profile/pages/UserDetailsPage"
import { useAvatarHairStyles } from "@/features/profile/hooks/useAvatarHairStyles"
import { useProfileUpdateMutation } from "@/features/profile/hooks/useProfileQuery"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import type { MannequinGender } from "@/features/profile/utils/mannequin"
import {
  HAIR_COLOR_OPTIONS,
  buildHairOptions,
  buildSkinToneOptions,
} from "@/features/profile/utils/figureOptions"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { ProfileRecord, ProfileUpdateInput } from "@/services/profile/profileService"

const AFTER_ONBOARDING_PATH = "/collection"

/**
 * The figure: a default mannequin for the chosen gender is already standing,
 * skin tone and hair are tune-ups, and the step can be left untouched. Step 2
 * of first run, and the same screen edits the figure from Profile. Saving
 * always sets the onboarding flag, so a repaired profile never bounces back
 * into first run.
 */
export function FigurePage({ mode = "onboarding" }: { mode?: ProfileStepMode } = {}) {
  const { profile, isLoading } = useProfileContext()

  if (isLoading) return null

  const gender: MannequinGender | null =
    profile?.gender === "male" || profile?.gender === "female" ? profile.gender : null
  // The figure needs a gender, and the basics screen is where it is chosen.
  if (!profile || !gender) {
    return <Navigate to={mode === "edit" ? PROFILE_DETAILS_PATH : ONBOARDING_ABOUT_PATH} replace />
  }

  return <FigureStep profile={profile} gender={gender} mode={mode} />
}

function FigureStep({
  profile,
  gender,
  mode,
}: {
  profile: ProfileRecord
  gender: MannequinGender
  mode: ProfileStepMode
}) {
  const navigate = useNavigate()
  const isEdit = mode === "edit"
  const { toast } = useToast()
  const isCompact = useIsFirstRunCompact()
  const updateProfile = useProfileUpdateMutation()
  const hairStylesQuery = useAvatarHairStyles(gender)

  const [skinTone, setSkinTone] = useState<string | null>(profile.selected_skin_tone ?? null)
  const [hairStyleId, setHairStyleId] = useState<string | null>(profile.hair_style_id ?? null)
  const [hairColorHex, setHairColorHex] = useState<string | null>(profile.hair_color_hex ?? null)
  const [isSaving, setIsSaving] = useState(false)

  const skinToneOptions = useMemo(() => buildSkinToneOptions(gender), [gender])
  const hairOptions = useMemo(
    () => buildHairOptions(gender, hairStylesQuery.data),
    [gender, hairStylesQuery.data],
  )

  const previewStyle =
    (hairStyleId ? hairStylesQuery.byId.get(hairStyleId) : null) ?? hairStylesQuery.defaultStyle
  const previewHairStyle: HeadAvatarHairStyle = previewStyle
    ? { styleKey: previewStyle.styleKey, gender }
    : null

  const single = (value: string | null, next: string) => (value === next ? null : next)

  const finish = async (updates: ProfileUpdateInput) => {
    setIsSaving(true)
    try {
      await updateProfile.mutateAsync({ ...updates, onboarding_complete: true })
      navigate(isEdit ? PROFILE_PATH : AFTER_ONBOARDING_PATH, { replace: true })
    } catch (error) {
      console.error("Failed to finish onboarding", error)
      toast({ title: "Couldn't save", description: "Please try again.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleContinue = () =>
    finish({
      selected_skin_tone: skinTone,
      hair_style_id: hairStyleId,
      hair_color_hex: hairColorHex,
    })

  // Head to the shoulder line only: the step is about skin and hair, not the body.
  const figure = (
    <FirstRunFigure
      crop="bust"
      gender={gender}
      skinToneHex={skinTone}
      hairStyle={previewHairStyle}
      hairColorHex={hairColorHex}
    />
  )

  return (
    <FirstRunShell
      step={2}
      eyebrow="Step 2 of 2"
      lede="Tune skin tone and hair."
      onBack={() => navigate(isEdit ? PROFILE_DETAILS_PATH : ONBOARDING_ABOUT_PATH)}
      backLabel="Back"
      footer={
        <Button
          onClick={handleContinue}
          disabled={isSaving}
          className="h-auto w-full rounded-control py-4 text-base font-bold text-primary-foreground"
        >
          {isSaving ? "Saving…" : isEdit ? "Save" : "Enter Atlyr"}
        </Button>
      }
      pane={figure}
    >
      {/* Phone: the figure absorbs the height left over by the pickers, so the screen needs no scroll. */}
      {isCompact && (
        <div
          className={cn("flex min-h-[120px] flex-1 items-center justify-center px-6", REVEAL_CLASS)}
          style={revealDelay(4)}
        >
          <div className="aspect-[5/4] h-full max-h-[300px]">{figure}</div>
        </div>
      )}

      <div className="flex shrink-0 flex-col pt-3">
        <div className={REVEAL_CLASS} style={revealDelay(5)}>
          <PickRow
            label="Skin tone"
            variant="swatch"
            options={skinToneOptions}
            selectedIds={skinTone ? [skinTone] : []}
            onToggle={(id) => setSkinTone(single(skinTone, id))}
          />
        </div>
        <div className={REVEAL_CLASS} style={revealDelay(6)}>
          <PickRow
            label="Hair"
            options={hairOptions}
            selectedIds={hairStyleId ? [hairStyleId] : []}
            onToggle={(id) => setHairStyleId(single(hairStyleId, id))}
          />
        </div>
        <div className={REVEAL_CLASS} style={revealDelay(7)}>
          <PickRow
            label="Hair colour"
            variant="swatch"
            options={HAIR_COLOR_OPTIONS}
            selectedIds={hairColorHex ? [hairColorHex] : []}
            onToggle={(id) => setHairColorHex(single(hairColorHex, id))}
          />
        </div>
      </div>
    </FirstRunShell>
  )
}

export default FigurePage
