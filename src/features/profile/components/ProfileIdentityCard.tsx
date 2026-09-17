import { useRef, useState } from "react"
import { Camera, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

type EditableNameProps = {
  name: string
  isSaving: boolean
  onSave: (name: string) => void
}

/** Tap to edit in place: Enter or blur saves, Escape restores the shown name. */
function EditableName({ name, isSaving, onSave }: EditableNameProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    const next = draft?.trim() ?? ""
    setDraft(null)
    if (next && next !== name) onSave(next)
  }

  const typography =
    "w-full min-w-0 font-display text-[28px] font-medium leading-tight tracking-[-0.02em] text-foreground sm:text-[32px]"

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(name)}
        disabled={isSaving}
        aria-label="Edit name"
        className={cn(
          typography,
          "cursor-text truncate rounded-sm text-left hover:text-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        )}
      >
        {name}
      </button>
    )
  }

  return (
    <input
      autoFocus
      value={draft}
      maxLength={60}
      aria-label="Name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") setDraft(null)
      }}
      className={cn(
        typography,
        "border-b-2 border-violet bg-transparent caret-violet outline-none placeholder:text-muted-foreground",
      )}
      placeholder="Your name"
    />
  )
}

type ProfilePhotoButtonProps = {
  photoUrl: string | null
  initial: string
  isUploading: boolean
  onPick: (file: File) => void
}

function ProfilePhotoButton({ photoUrl, initial, isUploading, onPick }: ProfilePhotoButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        aria-label={photoUrl ? "Change profile photo" : "Add profile photo"}
        className="group relative size-20 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:size-24"
      >
        <span className="flex size-full items-center justify-center overflow-hidden rounded-full border border-hairline bg-muted/30">
          {photoUrl ? (
            <img src={photoUrl} alt="" decoding="async" className="size-full object-cover" />
          ) : (
            <span className="font-display text-3xl text-muted-foreground">{initial}</span>
          )}
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full border-2 border-white bg-violet text-white shadow-xs transition-transform group-hover:scale-105">
          <Camera className="size-3.5" aria-hidden="true" />
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

type ProfileIdentityCardProps = {
  name: string
  photoUrl: string | null
  detailsLine: string
  email: string | null
  joinedLine: string | null
  isSavingName: boolean
  isUploadingPhoto: boolean
  onSaveName: (name: string) => void
  onPickPhoto: (file: File) => void
  onEditDetails: () => void
}

export function ProfileIdentityCard({
  name,
  photoUrl,
  detailsLine,
  email,
  joinedLine,
  isSavingName,
  isUploadingPhoto,
  onSaveName,
  onPickPhoto,
  onEditDetails,
}: ProfileIdentityCardProps) {
  return (
    <section
      aria-label="Your details"
      className="flex items-center gap-4 rounded-lg border border-hairline bg-white p-4 shadow-xs sm:gap-5 sm:p-5"
    >
      <ProfilePhotoButton
        photoUrl={photoUrl}
        initial={name.charAt(0).toUpperCase()}
        isUploading={isUploadingPhoto}
        onPick={onPickPhoto}
      />

      <div className="min-w-0 flex-1">
        <EditableName name={name} isSaving={isSavingName} onSave={onSaveName} />
        <p className="mt-1 truncate text-sm font-medium text-muted-foreground">{detailsLine}</p>
        {email ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{email}</p> : null}
        {joinedLine ? (
          <p className="mt-0.5 text-xs text-muted-foreground/80">joined {joinedLine}</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onEditDetails}
        aria-label="Edit details"
        className="group -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className="size-5 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </button>
    </section>
  )
}
