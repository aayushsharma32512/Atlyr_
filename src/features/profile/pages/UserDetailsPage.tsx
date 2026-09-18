import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Camera } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/contexts/AuthContext"
import { FirstRunShell } from "@/features/profile/components/FirstRunShell"
import { REVEAL_CLASS, revealDelay } from "@/features/profile/components/firstRunLayout"
import { PickRow } from "@/features/profile/components/PickRow"
import {
  GENDERS,
  HEIGHT_BANDS,
  SIZES,
  bandForHeight,
} from "@/features/profile/constants/figureVocabularies"
import { ONBOARDING_FIGURE_PATH } from "@/features/profile/constants/firstRun"
import { PROFILE_FIGURE_PATH, PROFILE_PATH } from "@/features/profile/constants/profilePaths"
import {
  useProfilePhotoMutation,
  useProfileUpdateMutation,
} from "@/features/profile/hooks/useProfileQuery"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const MIN_AGE = 13
const MAX_AGE = 100

const INPUT_CLASS =
  "w-full rounded-control border border-hairline bg-white px-4 py-4 text-base text-foreground placeholder:text-taupe transition-shadow focus:border-violet focus:outline-none focus:ring-1 focus:ring-violet"

/** First string value among `keys` in the auth metadata Google sign-in fills. */
function readMeta(meta: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = meta?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

export type ProfileStepMode = "onboarding" | "edit"

/**
 * Who you are: name, photo, age, gender, height and size in one pass;
 * everything but the photo is required. Step 1 of first run, and the same
 * screen edits those fields from Profile — only the back link and the next
 * destination differ. Name and photo prefill from Google sign-in when present;
 * Google does not share age or gender.
 */
export function UserDetailsPage({ mode = "onboarding" }: { mode?: ProfileStepMode } = {}) {
  const navigate = useNavigate()
  const isEdit = mode === "edit"
  const { toast } = useToast()
  const { user } = useAuth()
  const { profile, isLoading } = useProfileContext()
  const updateProfile = useProfileUpdateMutation()
  const uploadPhoto = useProfilePhotoMutation()

  const [name, setName] = useState("")
  const [age, setAge] = useState("")
  const [gender, setGender] = useState<string | null>(null)
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [size, setSize] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  const metadata = user?.user_metadata as Record<string, unknown> | undefined
  const existingPhotoUrl = readMeta(metadata, ["avatar_url", "picture"])

  useEffect(() => {
    if (isLoading || hasInitialized) return
    // The signup trigger writes "User" when Google sent no name — treat it as empty.
    const savedName = profile?.name && profile.name !== "User" ? profile.name : null
    setName(savedName ?? readMeta(metadata, ["full_name", "name"]) ?? "")
    setAge(profile?.age ? String(profile.age) : "")
    setGender(profile?.gender === "male" || profile?.gender === "female" ? profile.gender : null)
    setHeightCm(typeof profile?.height_cm === "number" ? profile.height_cm : null)
    setSize(profile?.size ?? null)
    setHasInitialized(true)
  }, [hasInitialized, isLoading, metadata, profile])

  const photoPreviewUrl = useMemo(
    () => (photoFile ? URL.createObjectURL(photoFile) : null),
    [photoFile],
  )
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
    }
  }, [photoPreviewUrl])
  const photoUrl = photoPreviewUrl ?? existingPhotoUrl

  const selectedHeightBand = bandForHeight(heightCm)

  const trimmedName = name.trim()
  const parsedAge = Number.parseInt(age, 10)
  const isAgeValid = Number.isFinite(parsedAge) && parsedAge >= MIN_AGE && parsedAge <= MAX_AGE
  const isFormValid = Boolean(trimmedName && isAgeValid && gender && heightCm !== null && size)

  const handleContinue = async () => {
    if (!isFormValid || !gender || !size || heightCm === null) return
    setIsSaving(true)
    try {
      if (photoFile) {
        // A failed photo never blocks the flow — it can be added later in Profile.
        await uploadPhoto.mutateAsync(photoFile).catch(() => {
          toast({
            title: "Photo didn't upload",
            description: "You can add it later from your profile.",
            variant: "destructive",
          })
        })
      }
      await updateProfile.mutateAsync({
        name: trimmedName,
        age: parsedAge,
        gender,
        height_cm: heightCm,
        size,
      })
      navigate(isEdit ? PROFILE_FIGURE_PATH : ONBOARDING_FIGURE_PATH)
    } catch (error) {
      console.error("Failed to save onboarding details", error)
      toast({ title: "Couldn't save", description: "Please try again.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const initial = trimmedName ? trimmedName.charAt(0).toUpperCase() : null

  const summary = [
    isAgeValid ? `${parsedAge}` : null,
    GENDERS.find((entry) => entry.id === gender)?.label ?? null,
    HEIGHT_BANDS.find((entry) => entry.id === selectedHeightBand)?.label ?? null,
    SIZES.find((entry) => entry.id === size)?.label ?? null,
  ].filter(Boolean)

  return (
    <FirstRunShell
      step={1}
      eyebrow="Step 1 of 2"
      onBack={isEdit ? () => navigate(PROFILE_PATH) : undefined}
      backLabel="Profile"
      footer={
        <Button
          onClick={handleContinue}
          disabled={isSaving || !isFormValid}
          className="h-auto w-full rounded-control py-4 text-base font-bold text-primary-foreground"
        >
          {isSaving ? "Saving…" : "Next"}
        </Button>
      }
      pane={<AboutPreview photoUrl={photoUrl} initial={initial} name={trimmedName} summary={summary} />}
    >
      <div className="flex flex-1 flex-col justify-evenly gap-4">
        <section className={cn("flex flex-col items-center gap-5 px-6", REVEAL_CLASS)} style={revealDelay(3)}>
          <PhotoWell photoUrl={photoUrl} initial={initial} onPick={setPhotoFile} />
          <div className="flex w-full gap-2.5">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name"
                autoComplete="name"
                autoCapitalize="words"
                className={cn(INPUT_CLASS, "font-voice text-lg font-medium italic placeholder:italic")}
              />
            </label>
            <label className="relative w-28 shrink-0">
              <span className="sr-only">Age</span>
              <input
                value={age}
                onChange={(event) => setAge(event.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                placeholder="Age"
                className={cn(
                  INPUT_CLASS,
                  "pr-12 font-voice text-lg font-medium italic placeholder:italic",
                  age && !isAgeValid && "border-destructive",
                )}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center font-voice text-sm font-medium italic text-taupe">
                {age && !isAgeValid ? `${MIN_AGE}–${MAX_AGE}` : "yrs"}
              </span>
            </label>
          </div>
        </section>

        <div className={REVEAL_CLASS} style={revealDelay(4)}>
          <PickRow
            label="Gender"
            variant="pill"
            layout="grid"
            columns={2}
            options={GENDERS}
            selectedIds={gender ? [gender] : []}
            onToggle={(id) => setGender(gender === id ? null : id)}
          />
        </div>

        <div className={REVEAL_CLASS} style={revealDelay(5)}>
          <PickRow
            label="Height"
            variant="pill"
            layout="grid"
            columns={5}
            options={HEIGHT_BANDS}
            selectedIds={selectedHeightBand ? [selectedHeightBand] : []}
            onToggle={(id) => {
              const band = HEIGHT_BANDS.find((entry) => entry.id === id)
              if (!band) return
              setHeightCm(selectedHeightBand === id ? null : band.cm)
            }}
          />
        </div>

        <div className={REVEAL_CLASS} style={revealDelay(6)}>
          <PickRow
            label="Size"
            variant="pill"
            layout="grid"
            columns={SIZES.length}
            options={SIZES}
            selectedIds={size ? [size] : []}
            onToggle={(id) => setSize(size === id ? null : id)}
          />
        </div>
      </div>
    </FirstRunShell>
  )
}

function PhotoWell({
  photoUrl,
  initial,
  onPick,
}: {
  photoUrl: string | null
  initial: string | null
  onPick: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={photoUrl ? "Change profile photo" : "Add profile photo"}
        className="group relative size-[140px] shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2"
      >
        <span
          className={cn(
            "flex size-full items-center justify-center overflow-hidden rounded-full border bg-white transition-colors",
            photoUrl ? "border-hairline" : "border-dashed border-hairline-4 group-hover:border-violet",
          )}
        >
          {photoUrl ? (
            <img src={photoUrl} alt="" decoding="async" className="size-full object-cover" />
          ) : initial ? (
            <span className="font-display text-[3rem] leading-none text-muted-foreground">{initial}</span>
          ) : (
            <Camera className="size-7 text-taupe" aria-hidden="true" />
          )}
        </span>
        <span className="absolute bottom-1 right-1 flex size-10 items-center justify-center rounded-full border-2 border-white bg-violet text-white shadow-sm transition-transform group-hover:scale-105">
          <Camera className="size-4" aria-hidden="true" />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) onPick(file)
        }}
      />
    </>
  )
}

/** Desktop pane: the profile card taking shape as the form fills in. */
function AboutPreview({
  photoUrl,
  initial,
  name,
  summary,
}: {
  photoUrl: string | null
  initial: string | null
  name: string
  summary: string[]
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex size-44 items-center justify-center overflow-hidden rounded-full border border-hairline bg-white shadow-[0_18px_48px_-24px_hsl(var(--ink)/0.45)]">
        {photoUrl ? (
          <img src={photoUrl} alt="" decoding="async" className="size-full object-cover" />
        ) : (
          <span className="font-display text-[4rem] leading-none text-muted-foreground">{initial ?? "·"}</span>
        )}
      </div>
      <p
        className={cn(
          "mt-8 max-w-[18ch] font-display text-[clamp(2rem,2.8vw,3rem)] font-medium leading-[1.05] transition-colors",
          name ? "text-foreground" : "text-taupe",
        )}
      >
        {name || "Your name"}
      </p>
      {summary.length > 0 && (
        <p className="mt-3 text-fluid-lg text-muted-foreground">{summary.join(" · ")}</p>
      )}
    </div>
  )
}

export default UserDetailsPage
