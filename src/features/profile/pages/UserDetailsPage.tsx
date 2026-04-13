import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ScreenHeader } from "@/design-system/primitives"
import { BasicInformationCard } from "@/features/profile/components/BasicInformationCard"
import { MannequinHeadAvatar } from "@/features/profile/components/MannequinHeadAvatar"
import type { DropdownOption } from "@/features/profile/components/DropdownSelector"
import { ExpandableDetailCard } from "@/features/profile/components/ExpandableDetailCard"
import type { Option } from "@/features/profile/components/OptionSelector"
import { useProfileUpdateMutation } from "@/features/profile/hooks/useProfileQuery"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useMannequinHead } from "@/features/profile/hooks/useMannequinHead"
import { useAvatarHairStyles } from "@/features/profile/hooks/useAvatarHairStyles"
import {
  applySkinToneToSvg,
  buildSvgDataUrl,
} from "@/features/profile/utils/mannequin"
import { AppShellLayout } from "@/layouts/AppShellLayout"

const SKIN_TONE_SWATCHES = ["#F5D7C2", "#E9C4A6", "#D3A17B", "#B8875F", "#8D5A3A", "#5C3A2E"]
const HAIR_COLOR_SWATCHES = [
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

function buildHeightOptions(): DropdownOption[] {
  const options: DropdownOption[] = []
  for (let feet = 4; feet <= 7; feet += 1) {
    const maxInches = feet === 7 ? 0 : 11
    for (let inches = 0; inches <= maxInches; inches += 1) {
      const totalInches = feet * 12 + inches
      const cm = Math.round(totalInches * 2.54)
      const label = `${feet}'${inches}" (${cm} cm)`
      options.push({
        id: `${cm}`,
        label,
        value: label,
      })
    }
  }
  return options
}

export function UserDetailsPage() {
  const navigate = useNavigate()
  const { profile, isLoading } = useProfileContext()
  const updateProfileMutation = useProfileUpdateMutation()
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState("")
  const [age, setAge] = useState("")
  const [gender, setGender] = useState("")
  const [selectedSkinTone, setSelectedSkinTone] = useState<string | null>(null)
  const [selectedHairStyleId, setSelectedHairStyleId] = useState<string | null>(null)
  const [selectedHairColorHex, setSelectedHairColorHex] = useState<string | null>(null)
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [skinToneOptions, setSkinToneOptions] = useState<Option[]>([])
  const [hasInitialized, setHasInitialized] = useState(false)
  const previousGenderRef = useRef<"male" | "female" | null>(null)
  const resolvedGender = gender === "male" || gender === "female" ? gender : null
  const { baseSvg } = useMannequinHead({ gender: resolvedGender, skinTone: null })
  const hairStylesQuery = useAvatarHairStyles(resolvedGender)
  const resolvedHairStyleForPreview = useMemo(() => {
    if (!hairStylesQuery.data.length) {
      return null
    }
    if (selectedHairStyleId && hairStylesQuery.byId.has(selectedHairStyleId)) {
      return hairStylesQuery.byId.get(selectedHairStyleId) ?? null
    }
    return hairStylesQuery.defaultStyle
  }, [hairStylesQuery.byId, hairStylesQuery.data.length, hairStylesQuery.defaultStyle, selectedHairStyleId])

  useEffect(() => {
    if (isLoading || hasInitialized) {
      return
    }

    if (profile) {
      const initialName = profile.name === "User" ? "" : profile.name
      setName(initialName ?? "")
      setAge(profile.age ? profile.age.toString() : "")
      setGender(
        profile.gender === "male" || profile.gender === "female" ? profile.gender : ""
      )
      setSelectedSkinTone(profile.selected_skin_tone ?? null)
      setSelectedHairStyleId(profile.hair_style_id ?? null)
      setSelectedHairColorHex(profile.hair_color_hex ?? null)
      setHeightCm(typeof profile.height_cm === "number" ? profile.height_cm : null)
    }

    setHasInitialized(true)
  }, [hasInitialized, isLoading, profile])

  useEffect(() => {
    if (!resolvedGender) {
      previousGenderRef.current = null
      setSkinToneOptions([])
      return
    }

    if (previousGenderRef.current && previousGenderRef.current !== resolvedGender) {
      setSelectedSkinTone(null)
      setSelectedHairStyleId(null)
    }
    previousGenderRef.current = resolvedGender

    if (!baseSvg) {
      setSkinToneOptions([])
      return
    }

    const options = SKIN_TONE_SWATCHES.map((hex, index) => {
      const tintedSvg = applySkinToneToSvg(baseSvg, hex)
      return {
        id: hex,
        label: `Tone ${index + 1}`,
        imageUrl: buildSvgDataUrl(tintedSvg),
      }
    })
    setSkinToneOptions(options)
  }, [baseSvg, resolvedGender])

  const trimmedName = name.trim()
  const parsedAge = Number.parseInt(age, 10)
  const isFormValid =
    trimmedName.length > 0 &&
    Number.isFinite(parsedAge) &&
    parsedAge > 0 &&
    (gender === "male" || gender === "female")

  const handleSave = async () => {
    if (!isFormValid) {
      return
    }

    setIsSaving(true)
    try {
      await updateProfileMutation.mutateAsync({
        name: trimmedName,
        age: parsedAge,
        gender,
        onboarding_complete: true,
        ...(selectedSkinTone ? { selected_skin_tone: selectedSkinTone } : {}),
        hair_style_id: selectedHairStyleId,
        hair_color_hex: selectedHairColorHex,
        ...(typeof heightCm === "number" ? { height_cm: heightCm } : {}),
      })
      navigate("/home")
    } catch (error) {
      console.error("Failed to save user details", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleBack = () => {
    navigate("/profile")
  }

  const handleSelectionChange = (sectionTitle: string, optionId: string) => {
    if (sectionTitle === "Skin Tone") {
      setSelectedSkinTone(optionId)
    }
    if (sectionTitle === "Hair Type") {
      setSelectedHairStyleId(optionId)
    }
    if (sectionTitle === "Hair Color") {
      setSelectedHairColorHex(optionId)
    }
    if (sectionTitle === "Height") {
      const parsedHeight = Number.parseInt(optionId, 10)
      setHeightCm(Number.isFinite(parsedHeight) ? parsedHeight : null)
    }
  }

  const heightOptions = useMemo(() => buildHeightOptions(), [])

  const facialFeaturesSections = useMemo(
    () => [
      {
        title: "Skin Tone",
        options: skinToneOptions,
      },
      {
        title: "Hair Type",
        options: (hairStylesQuery.data ?? []).map((style) => ({
          id: style.id,
          label: style.styleKey,
          imageUrl: style.assetUrl,
        })),
      },
      {
        title: "Hair Color",
        options: HAIR_COLOR_SWATCHES.map((hex) => ({
          id: hex,
          label: hex,
          color: hex,
        })),
      },
    ],
    [hairStylesQuery.data, skinToneOptions],
  )

  const bodyDetailsSections = useMemo(
    () => [
      {
        title: "Height",
        type: "dropdown" as const,
        options: heightOptions,
      },
      /*
      {
        title: "Build Type",
        type: "image" as const,
        options: [
          { id: "build-1", label: "Skinny" },
          { id: "build-2", label: "Slim" },
          { id: "build-3", label: "Average" },
          { id: "build-4", label: "Athletic" },
          { id: "build-5", label: "Muscular" },
        ],
      },
      */
    ],
    [heightOptions],
  )

  const facialSelections = useMemo<Record<string, string>>(
    () => ({
      ...(selectedSkinTone ? { "Skin Tone": selectedSkinTone } : {}),
      ...(selectedHairStyleId ? { "Hair Type": selectedHairStyleId } : {}),
      ...(selectedHairColorHex ? { "Hair Color": selectedHairColorHex } : {}),
    }),
    [selectedHairColorHex, selectedHairStyleId, selectedSkinTone],
  )

  const bodySelections = useMemo<Record<string, string>>(
    () => (typeof heightCm === "number" ? { Height: heightCm.toString() } : {}),
    [heightCm],
  )

  return (
    <AppShellLayout>
      <div className="relative flex flex-1 flex-col min-h-0 bg-background">
        <ScreenHeader
          onAction={handleBack}
          className="absolute left-4 top-4 z-20 px-0 pt-0 pb-0"
        />
        {/* Scrollable Content */}
        <ScrollArea className="flex-1 min-h-0 w-full">
          <div className="px-4 pt-6 pb-4 space-y-4">
            {/* Basic Information Card */}
            <BasicInformationCard
              name={name}
              age={age}
              gender={gender}
              skinTone={selectedSkinTone}
              hairStyleId={selectedHairStyleId}
              hairColorHex={selectedHairColorHex}
              onNameChange={setName}
              onAgeChange={setAge}
              onGenderChange={setGender}
            />

            {/* Facial Features Card */}
            <ExpandableDetailCard
              title="Facial Features"
              icon={
                <MannequinHeadAvatar
                  size={64}
                  gender={resolvedGender}
                  skinToneHex={selectedSkinTone}
                  hairStyle={
                    resolvedHairStyleForPreview
                      ? {
                          assetUrl: resolvedHairStyleForPreview.assetUrl,
                          lengthPct: resolvedHairStyleForPreview.lengthPct,
                          yOffsetPct: resolvedHairStyleForPreview.yOffsetPct,
                          xOffsetPct: resolvedHairStyleForPreview.xOffsetPct,
                          zIndex: resolvedHairStyleForPreview.zIndex,
                        }
                      : null
                  }
                  hairColorHex={selectedHairColorHex}
                />
              }
              items={[
                { label: "Skin Tone" },
                { label: "Hair Type" },
                { label: "Hair Color" },
              ]}
              selectionSections={facialFeaturesSections}
              onSelectionChange={handleSelectionChange}
              selectedValues={facialSelections}
            />

            {/* Body Details Card */}
            <ExpandableDetailCard
              title="Body Details"
              items={[
                { label: "Height" },
                /*
                { label: "Build Type" },
                */
              ]}
              selectionSections={bodyDetailsSections}
              onSelectionChange={handleSelectionChange}
              selectedValues={bodySelections}
            />
          </div>
        </ScrollArea>

        {/* Save Button - Fixed at bottom */}
        <div className="px-4 py-4 shrink-0 border-t border-border bg-background">
          <Button
            onClick={handleSave}
            disabled={isSaving || !isFormValid}
            className="w-full bg-foreground text-background hover:bg-foreground/90 h-11 rounded-lg"
          >
            {isSaving ? "Saving..." : "Save Details"}
          </Button>
        </div>
      </div>
    </AppShellLayout>
  )
}

export default UserDetailsPage
