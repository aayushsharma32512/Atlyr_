import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { WordmarkLockup } from "@/design-system/primitives"
import {
  FirstRunBrandGround,
  FirstRunFigure,
  FirstRunPane,
} from "@/features/profile/components/FirstRunPreview"
import { type HeadAvatarHairStyle } from "@/features/profile/components/MannequinHeadAvatar"
import { DropdownSelector, type DropdownOption } from "@/features/profile/components/DropdownSelector"
import { PickRow, type PickTile } from "@/features/profile/components/PickRow"
import {
  GENDERS,
  HEIGHT_BANDS,
  SIZES,
  bandForHeight,
} from "@/features/profile/constants/figureVocabularies"
import { TASTE_IN_FIRST_RUN } from "@/features/profile/constants/firstRun"
import { useProfileUpdateMutation } from "@/features/profile/hooks/useProfileQuery"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useAvatarHairStyles } from "@/features/profile/hooks/useAvatarHairStyles"
import {
  PLACEMENT_CANVAS_WIDTH,
  headCropRect,
} from "@/features/studio/constants/mannequinAnchors"
import { useIsMobile } from "@/hooks/use-mobile"

/** Tailwind's `lg`. Below this the figure preview moves into a pinned strip. */
const TWO_PANE_BREAKPOINT = 1024
import { SKIN_TONE_STEPS, skinToneChipColor } from "@/shared/skin/melanin"

/**
 * Canvas 6c2 — "the figure, roughly right". Second half of first run, and the
 * profile editor for the same fields once onboarding is done. Both modes share
 * the row grammar; only the chrome differs (wordmark + step eyebrow + skip on
 * first run, back button + Save on edit).
 *
 * NOT PERSISTED THIS PASS — body type and size are rendered but have nowhere to
 * go: `profiles` has a `selected_silhouette` column that nothing writes, and no
 * size column at all. Wiring either means adding a key to the mutation below,
 * which was deliberately left out of a UI-only pass. The rows say so on their
 * face rather than pretending. See TODO(wave-3) at the state declarations.
 */

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
      options.push({ id: `${cm}`, label, value: label })
    }
  }
  return options
}

export interface UserDetailsPageProps {
  /**
   * Render the first-run chrome regardless of profile state. Only for the
   * /design-system preview route — an onboarded account would otherwise always
   * see the edit chrome and never the screen as designed.
   */
  forceFirstRunChrome?: boolean
}

export function UserDetailsPage({ forceFirstRunChrome = false }: UserDetailsPageProps = {}) {
  const navigate = useNavigate()
  const isCompact = useIsMobile(TWO_PANE_BREAKPOINT)
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
  const [showExactHeight, setShowExactHeight] = useState(false)
  // TODO(wave-3): size has no home yet — it needs a column, and the handoff
  // scopes it to the PDP size hint, never a catalog filter. Body type is pulled
  // from the screen for now; its vocabulary is still in figureVocabularies.
  const [selectedSize, setSelectedSize] = useState<string | null>(null)

  const [hasInitialized, setHasInitialized] = useState(false)
  const previousGenderRef = useRef<"male" | "female" | null>(null)
  const resolvedGender = gender === "male" || gender === "female" ? gender : null
  const hairStylesQuery = useAvatarHairStyles(resolvedGender)

  /**
   * The 6c2 layout is now the ONLY layout — reaching this page from Profile
   * used to drop you into a different screen entirely (ScreenHeader, bottom
   * nav, a 64px head thumbnail instead of the live figure), so the thing you
   * were editing was barely visible. Same picker, same measure, same figure
   * pane, whichever door you came through.
   *
   * What still varies is only what is TRUE in each case: the eyebrow, the CTA,
   * and where it takes you. Onboarding has no way back and ends at /home;
   * editing has a back link and returns to /profile.
   */
  const isOnboarding = forceFirstRunChrome || (!isLoading && !profile?.onboarding_complete)

  const resolvedHairStyleForPreview = useMemo(() => {
    if (!hairStylesQuery.data.length) {
      return null
    }
    if (selectedHairStyleId && hairStylesQuery.byId.has(selectedHairStyleId)) {
      return hairStylesQuery.byId.get(selectedHairStyleId) ?? null
    }
    return hairStylesQuery.defaultStyle
  }, [
    hairStylesQuery.byId,
    hairStylesQuery.data.length,
    hairStylesQuery.defaultStyle,
    selectedHairStyleId,
  ])

  useEffect(() => {
    if (isLoading || hasInitialized) {
      return
    }

    if (profile) {
      const initialName = profile.name === "User" ? "" : profile.name
      setName(initialName ?? "")
      setAge(profile.age ? profile.age.toString() : "")
      setGender(
        profile.gender === "male" || profile.gender === "female" ? profile.gender : "",
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
      return
    }

    if (previousGenderRef.current && previousGenderRef.current !== resolvedGender) {
      setSelectedSkinTone(null)
      setSelectedHairStyleId(null)
    }
    previousGenderRef.current = resolvedGender
  }, [resolvedGender])

  /**
   * Swatches show the MANNEQUIN'S OWN skin retoned, not the raw reference
   * colour — the reference chips are flat patches measured under controlled
   * light, so showing them directly means the swatch you pick looks nothing
   * like the body you get. Pure arithmetic, no image decoding.
   *
   * The stored id stays `step.hex` because that is what the renderer's
   * `projectHexToTone()` is calibrated against. Canvas 6c2 draws a different
   * six-step ramp; those values are illustrative and would feed unvalidated
   * hexes into the renderer, so this keeps the canvas's *grammar* (numbered
   * swatch cards) with the codebase's *values*.
   */
  const skinToneOptions = useMemo<PickTile[]>(() => {
    if (!resolvedGender) return []
    return SKIN_TONE_STEPS.map((step, index) => ({
      id: step.hex,
      label: String(index + 1).padStart(2, "0"),
      description: step.label,
      color: skinToneChipColor(resolvedGender, step.tone),
    }))
  }, [resolvedGender])

  /**
   * Thumbnails come from the baked photoreal cutouts in /public/hair-baked,
   * keyed by styleKey — NOT from `assetUrl`. That asset is a compositing layer
   * for the mannequin: a flat black silhouette meant to be recoloured and
   * positioned on a head, which as a standalone thumbnail is an unreadable blob.
   * A style with no baked cutout falls back to the labelled placeholder.
   */
  const hairOptions = useMemo<PickTile[]>(() => {
    if (!resolvedGender) return []
    // Baked cutouts are full mannequin canvases, so crop to the head using the
    // renderer's own rect rather than eyeballing one.
    const rect = headCropRect(resolvedGender)
    const crop = {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      naturalWidth: PLACEMENT_CANVAS_WIDTH,
    }
    return (hairStylesQuery.data ?? []).map((style) => ({
      id: style.id,
      label: style.styleKey,
      imageUrl: `/hair-baked/${resolvedGender}/${style.styleKey}.webp`,
      imageCrop: crop,
    }))
  }, [hairStylesQuery.data, resolvedGender])

  const hairColorOptions = useMemo<PickTile[]>(
    () =>
      HAIR_COLOR_SWATCHES.map((hex) => ({
        id: hex,
        label: "",
        description: `Hair colour ${hex}`,
        color: hex,
      })),
    [],
  )

  const heightOptions = useMemo(() => buildHeightOptions(), [])
  // Derived, never stored: an existing exact height highlights its band without
  // being rewritten to the band's representative value.
  const selectedHeightBand = bandForHeight(heightCm)

  const trimmedName = name.trim()
  const parsedAge = Number.parseInt(age, 10)
  const isFormValid =
    trimmedName.length > 0 &&
    Number.isFinite(parsedAge) &&
    parsedAge > 0 &&
    (gender === "male" || gender === "female")

  const persistableFigure = () => ({
    ...(trimmedName ? { name: trimmedName } : {}),
    ...(Number.isFinite(parsedAge) && parsedAge > 0 ? { age: parsedAge } : {}),
    ...(gender === "male" || gender === "female" ? { gender } : {}),
    ...(selectedSkinTone ? { selected_skin_tone: selectedSkinTone } : {}),
    hair_style_id: selectedHairStyleId,
    hair_color_hex: selectedHairColorHex,
    ...(typeof heightCm === "number" ? { height_cm: heightCm } : {}),
  })

  const commit = async (updates: Record<string, unknown>, destination: string) => {
    setIsSaving(true)
    try {
      await updateProfileMutation.mutateAsync(updates)
      navigate(destination)
    } catch (error) {
      console.error("Failed to save user details", error)
    } finally {
      setIsSaving(false)
    }
  }

  // First run never blocks: every row is optional, and so is the whole step.
  const handleContinue = () =>
    commit({ ...persistableFigure(), onboarding_complete: true }, "/home")

  // "Use a neutral figure" — take nothing, but still clear the gate so the
  // AppShellLayout redirect doesn't bounce them straight back here.
  const handleSkip = () => commit({ onboarding_complete: true }, "/home")

  const handleSave = () => {
    if (!isFormValid) return
    commit({ ...persistableFigure(), onboarding_complete: true }, "/profile")
  }

  const single = (value: string | null, next: string) => (value === next ? null : next)

  // One value for both preview hosts — the phone strip and the lg+ pane render
  // the same figure, and only one of them is ever mounted. Annotated because an
  // un-annotated object literal widens `gender` from the "male" | "female"
  // union back to plain string.
  const previewHairStyle: HeadAvatarHairStyle =
    resolvedGender && resolvedHairStyleForPreview
      ? { styleKey: resolvedHairStyleForPreview.styleKey, gender: resolvedGender }
      : null

  // The max-w is the measure, and everything inside hangs off one left axis at
  // px-[26px] — see the notes in TastePage. In first run this is the left pane
  // of a flex row; in edit mode it is the only child of AppShellLayout.
  const screen = (
    <div className="relative flex min-h-0 w-full max-w-[720px] flex-1 flex-col overflow-hidden bg-background">
        <header className="shrink-0 pt-6">
          {/* Onboarding has nowhere to go back TO — the gate would bounce you
              straight here again. Editing does, and without this the only exit
              is saving, since the first-run layout has no bottom nav. */}
          {!isOnboarding && (
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="mb-3 flex items-center gap-1 px-[26px] text-fluid-sm font-semibold text-muted-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Profile
            </button>
          )}
          <WordmarkLockup size="firstRun" className="items-start px-[26px]" />
          <div className="px-[26px] pt-4">
            <p className="flex items-center gap-2 text-fluid-sm font-semibold uppercase tracking-[0.22em] text-primary">
              {isOnboarding
                ? TASTE_IN_FIRST_RUN
                  ? "First run · step 2 of 2"
                  : "First run · 30 seconds"
                : "Your figure"}
              {isOnboarding && TASTE_IN_FIRST_RUN && (
                <span className="flex gap-[3px]" aria-hidden="true">
                  <span className="h-0.5 w-3 bg-primary" />
                  <span className="h-0.5 w-3 bg-primary" />
                </span>
              )}
            </p>
            <h1 className="mb-1 mt-[7px] font-display text-fluid-h1 font-medium leading-[1.08] text-foreground">
              The figure,
              <br />
              roughly right.
            </h1>
            <p className="text-fluid-lg leading-[1.5] text-muted-foreground">
              So looks land on someone shaped like you. Photos come later, in the Studio.
            </p>
          </div>
        </header>

        {/* Deliberately not Radix ScrollArea: its viewport wraps children in a
            display:table element, which sizes to content. Any row wider than the
            frame then widened the whole page instead of scrolling inside its
            rail. A plain block scroller keeps normal width constraints. */}
        <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
          <div className="pb-6 pt-4">
            <section className="px-6 pb-[13px]">
              <div className="flex items-center gap-2.5">
                <span className="text-fluid-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  You
                </span>
                <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
              </div>
              <div className="mt-2 flex gap-2">
                <label className="flex-1">
                  <span className="sr-only">Name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="your name"
                    className="w-full rounded-[5px] border border-hairline bg-card px-3 py-2 text-fluid-md text-foreground placeholder:text-taupe focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="w-20">
                  <span className="sr-only">Age</span>
                  <input
                    value={age}
                    onChange={(event) => setAge(event.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    placeholder="age"
                    className="w-full rounded-[5px] border border-hairline bg-card px-3 py-2 text-fluid-md text-foreground placeholder:text-taupe focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            </section>

            <PickRow
              label="Figure"
              hint="pick one"
              variant="pill"
              options={GENDERS}
              selectedIds={gender ? [gender] : []}
              onToggle={(id) => setGender(gender === id ? "" : id)}
            />

            {resolvedGender && (
              <>
                <PickRow
                  label="Skin tone"
                  hint="pick one"
                  variant="swatch"
                  options={skinToneOptions}
                  selectedIds={selectedSkinTone ? [selectedSkinTone] : []}
                  onToggle={(id) => setSelectedSkinTone(single(selectedSkinTone, id))}
                />

                <PickRow
                  label="Hair"
                  searchable
                  options={hairOptions}
                  selectedIds={selectedHairStyleId ? [selectedHairStyleId] : []}
                  onToggle={(id) => setSelectedHairStyleId(single(selectedHairStyleId, id))}
                />

                <PickRow
                  label="Hair colour"
                  hint="pick one"
                  variant="swatch"
                  options={hairColorOptions}
                  selectedIds={selectedHairColorHex ? [selectedHairColorHex] : []}
                  onToggle={(id) => setSelectedHairColorHex(single(selectedHairColorHex, id))}
                />
              </>
            )}

            <PickRow
              label="Height"
              hint="pick one"
              variant="pill"
              options={HEIGHT_BANDS}
              selectedIds={selectedHeightBand ? [selectedHeightBand] : []}
              onToggle={(id) => {
                const band = HEIGHT_BANDS.find((entry) => entry.id === id)
                if (!band) return
                setHeightCm(selectedHeightBand === id ? null : band.cm)
              }}
            />

            <div className="-mt-2 px-6 pb-[13px]">
              {showExactHeight ? (
                <DropdownSelector
                  title="Exact height"
                  options={heightOptions}
                  selectedId={typeof heightCm === "number" ? heightCm.toString() : undefined}
                  placeholder="Exact height"
                  onSelect={(id) => {
                    const parsed = Number.parseInt(id, 10)
                    setHeightCm(Number.isFinite(parsed) ? parsed : null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowExactHeight(true)}
                  className="text-fluid-xs2 font-medium text-muted-foreground underline underline-offset-2"
                >
                  {typeof heightCm === "number"
                    ? `set exactly — currently ${heightCm} cm`
                    : "set exactly"}
                </button>
              )}
            </div>

            <PickRow
              label="Size you usually wear"
              hint="not saved yet"
              variant="pill"
              options={SIZES}
              selectedIds={selectedSize ? [selectedSize] : []}
              onToggle={(id) => setSelectedSize(single(selectedSize, id))}
            />

            {/* The inline 64px preview that used to sit here in edit mode is
                gone. Both hosts now exist on every entry — pinned below on a
                phone, in the pane beside at lg+ — so a thumbnail at the bottom
                of the scroll would be a third copy of the same figure, and the
                worst-placed one: you had to pass every picker to reach it. */}
          </div>
        </div>

        {/* Phone: the figure pinned between the scroller and the CTA, so a skin
            tone or hair pick shows its effect without scrolling. Head crop, not
            figure — a band this short at the mannequin's 1800x3072 aspect would
            be about 59px wide. Collapsed entirely until a figure is chosen,
            rather than pinning an empty band above the CTA. */}
        {isCompact && resolvedGender && (
          <div className="flex h-[112px] shrink-0 items-center gap-4 border-t border-hairline bg-background px-[26px]">
            {/* Boxed, not stretched across the band. The head crop is roughly
                square, so given the full width it scales to fit the height and
                leaves a ~100px head marooned in the middle of a wide strip —
                worst on tablets. A square host on the left axis fills properly
                at every width. */}
            <div className="h-full w-[96px] shrink-0 py-2">
              <FirstRunFigure
                crop="head"
                gender={resolvedGender}
                skinToneHex={selectedSkinTone}
                hairStyle={previewHairStyle}
                hairColorHex={selectedHairColorHex}
              />
            </div>
            <p className="text-fluid-base leading-[1.5] text-muted-foreground">
              Your figure so far — it changes as you pick.
            </p>
          </div>
        )}

        {/* Same band, same button, both ways in — only the words and the
            destination change, because those are the parts that actually
            differ. Editing keeps "Save details" disabled until the form is
            valid; onboarding never blocks you, since Skip is the escape. */}
        <footer className="shrink-0 border-t border-hairline bg-background px-[26px] pb-6 pt-3.5">
          <p className="mb-2.5 text-fluid-base font-medium text-muted-foreground">
            Nothing here is a measurement — it picks a starting figure. Edit in Profile → Likeness.
          </p>
          <Button
            onClick={isOnboarding ? handleContinue : handleSave}
            disabled={isSaving || (!isOnboarding && !isFormValid)}
            className="h-auto w-full rounded-[3px] py-fluid-btn text-fluid-cta font-bold"
          >
            {isSaving ? "Saving…" : isOnboarding ? "Start exploring →" : "Save details"}
          </Button>
          {isOnboarding && (
            <button
              type="button"
              onClick={handleSkip}
              disabled={isSaving}
              className="mt-3 w-full text-left text-fluid-md font-medium text-muted-foreground"
            >
              Skip — use a neutral figure
            </button>
          )}
        </footer>
    </div>
  )

  // The page owns the whole viewport either way — no bottom nav.
  //
  // In onboarding a nav is a trapdoor: tapping it leaves the flow only for the
  // AppShellLayout gate to bounce you straight back. When editing there is no
  // gate, but the shell would cost the figure pane its height and put a nav bar
  // under a screen whose whole point is the live figure — so the back link in
  // the header is the way out instead.
  //
  // The gutter is 0 until the viewport passes the measure, so 390px is untouched
  // and only tablets and up stop hugging the left edge.
  return (
    <div className="flex h-[100dvh] flex-row bg-background pl-[clamp(0px,(100vw_-_720px)*0.25,160px)]">
      {screen}

      {/* The whole point of the width: the figure, live, updating as you pick.
          Until a gender is chosen there is nothing to draw — show the brand
          ground rather than guessing at a body, since choosing it is what the
          step is for. */}
      {!isCompact && (
        <FirstRunPane>
          {resolvedGender ? (
            <FirstRunFigure
              crop="figure"
              gender={resolvedGender}
              skinToneHex={selectedSkinTone}
              hairStyle={previewHairStyle}
              hairColorHex={selectedHairColorHex}
            />
          ) : (
            <FirstRunBrandGround caption="Pick a figure and it appears here — skin tone and hair land on it as you go." />
          )}
        </FirstRunPane>
      )}
    </div>
  )
}

export default UserDetailsPage
