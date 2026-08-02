import { UseFormReturn, useWatch } from "react-hook-form"
import { CardHeader, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { Check, Loader2, Maximize2, Plus, Sparkles } from "lucide-react"
import { useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { STUDIO_LAST_PATH_STORAGE_KEY } from "@/features/studio/constants"
import type { LikenessFormData } from "../types"
import type { LikenessPose } from "@/services/likeness/likenessService"

interface StepThreeFormProps {
  type: "drawer" | "screen"
  form: UseFormReturn<LikenessFormData>
  poses: LikenessPose[]
  onGenerateNew: () => void
  onUseAvatar?: (poseId: string) => void
  onSetActive: (poseId: string) => void
  isSettingActive?: boolean
  isGeneratingTryOn?: boolean
  savedMode?: boolean
  savedPoseId?: string | null
  showUseAvatarButton?: boolean
  /** 6n2: "Manage all poses ›" — through to the 6o2 gallery. */
  onManagePoses?: () => void
}

export const poseDate = (value: string) => {
  const d = new Date(value)
  return `${d.getDate().toString().padStart(2, "0")} ${d.toLocaleString("default", { month: "short" })}`
}

/**
 * The canvas labels poses "Standing · natural light", "Seated · studio". We do
 * not generate or store that — `LikenessPose` carries only id/date/active/image
 * plus an open `metadata` bag. So: use a label if one ever lands in metadata,
 * otherwise a plain noun. Inventing pose descriptions the pipeline never
 * produced would be a caption that lies.
 *
 * Deliberately NOT the date: the gallery already prints "made {date}" beneath,
 * and a title identical to its own subtitle reads like a rendering bug.
 */
export function poseLabel(pose: LikenessPose): string {
  const fromMeta = pose.metadata?.label
  return typeof fromMeta === "string" && fromMeta.trim() ? fromMeta : "Neutral pose"
}

export function StepThreeForm({
  type,
  form,
  poses,
  onGenerateNew,
  onUseAvatar,
  onSetActive,
  isSettingActive = false,
  isGeneratingTryOn = false,
  savedMode = false,
  savedPoseId = null,
  showUseAvatarButton = true,
  onManagePoses,
}: StepThreeFormProps) {
  const isDrawer = type === "drawer"
  const watchedSelectedAvatar = useWatch({
    control: form.control,
    name: "selectedBaseAvatar",
  })

  const sortedPoses = useMemo(() => poses ?? [], [poses])
  const activePoseId = useMemo(
    () => sortedPoses.find((pose) => pose.isActive)?.id ?? null,
    [sortedPoses],
  )
  const isSavedPoseAvailable = useMemo(() => {
    if (!savedMode || !savedPoseId) {
      return true
    }
    return sortedPoses.some((pose) => pose.id === savedPoseId)
  }, [savedMode, savedPoseId, sortedPoses])
  const preferredSavedId = savedMode ? savedPoseId : null
  const selectedAvatar = watchedSelectedAvatar ?? preferredSavedId ?? activePoseId

  useEffect(() => {
    if (watchedSelectedAvatar) {
      return
    }
    if (savedMode && savedPoseId) {
      form.setValue("selectedBaseAvatar", savedPoseId, { shouldDirty: false })
      return
    }
    if (activePoseId) {
      form.setValue("selectedBaseAvatar", activePoseId, { shouldDirty: false })
    }
  }, [activePoseId, form, savedPoseId, savedMode, watchedSelectedAvatar])
  const actionChipProps = {
    role: "button" as const,
    tabIndex: 0,
    className: "flex gap-1 h-6 items-center justify-center rounded-[8px] px-1 text-foreground bg-card/80 text-[11px] font-medium",
    onKeyDown:
      (handler: (event: React.KeyboardEvent<HTMLSpanElement>) => void) =>
      (event: React.KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          handler(event)
        }
      },
  }

  const handleSelectAvatar = (pose: LikenessPose) => {
    if (savedMode) {
      return
    }
    form.setValue("selectedBaseAvatar", pose.id)
    onSetActive(pose.id)
  }

  const handleUseAvatar = () => {
    if (!onUseAvatar) {
      return
    }
    if (selectedAvatar) {
      onUseAvatar(selectedAvatar)
    }
  }

  const navigate = useNavigate()
  const handleGoToStudio = () => {
    const storedPath =
      typeof window !== "undefined" ? window.sessionStorage.getItem(STUDIO_LAST_PATH_STORAGE_KEY) : null
    const normalizedPath = (() => {
      if (!storedPath) {
        return "/studio"
      }
      if (storedPath.startsWith("/studio")) {
        return storedPath
      }
      if (storedPath.startsWith("/design-system/studio")) {
        return storedPath.replace("/design-system", "")
      }
      return "/studio"
    })()
    navigate(normalizedPath || "/studio")
  }

  return (
    <Form {...form}>
      <div
        className={`flex flex-1 flex-col min-h-0 h-full w-auto mx-auto ${
          type === "drawer" ? "border-none shadow-none" : ""
        }`}
      >
        {savedMode && !isSavedPoseAvailable ? (
          <div className="px-6 pt-4 shrink-0 flex justify-center">
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted-foreground/10 px-2 py-1 rounded">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading saved likeness...
            </span>
          </div>
        ) : null}

        {/* Canvas 6n2 — the step first-timers never see. Once a likeness exists,
            "Try it on" opens this picker, not the 6n gate. The active pose is
            already chosen, so the common case is one tap on the primary button;
            switching is available but never demanded. */}
        {isDrawer && !savedMode ? (
          <>
            <div className="shrink-0 px-5 pb-1 pt-2">
              <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-terracotta">
                Try it on · as who?
              </p>
              <h2 className="mt-1.5 font-display text-[22px] font-medium leading-tight text-foreground">
                Pick a likeness
              </h2>
              <p className="mt-1 text-[9.5px] text-muted-foreground">
                Your active pose is preselected — one tap to switch.
              </p>
            </div>

            <div className="flex min-h-0 shrink-0 gap-2 overflow-x-auto px-5 py-3 scrollbar-hide">
              {sortedPoses.map((pose) => {
                const isSelected = selectedAvatar === pose.id
                return (
                  <button
                    key={pose.id}
                    type="button"
                    onClick={() => handleSelectAvatar(pose)}
                    className={`flex w-[92px] shrink-0 flex-col overflow-hidden rounded-[5px] border bg-card text-left transition-colors ${
                      isSelected ? "border-gold" : "border-hairline hover:border-hairline-4"
                    }`}
                  >
                    <span className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden bg-ink-deep">
                      {pose.imageUrl ? (
                        <img src={pose.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[7px] uppercase tracking-[0.1em] text-on-ink-3">render</span>
                      )}
                      {pose.isActive ? (
                        <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-[2px] bg-ink-deepest/75 px-1 py-[2px] text-[6px] font-bold uppercase tracking-[0.12em] text-gold">
                          <Sparkles className="size-2" aria-hidden="true" />
                          Active
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate px-1.5 py-1 text-[8px] font-medium text-foreground">
                      {poseLabel(pose)}
                    </span>
                  </button>
                )
              })}

              <button
                type="button"
                onClick={onGenerateNew}
                className="flex w-[92px] shrink-0 flex-col items-center justify-center gap-1 rounded-[5px] border border-dashed border-hairline-4 bg-card/40 text-muted-foreground hover:border-ink-line"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                <span className="text-[8px] font-medium">New likeness</span>
              </button>
            </div>

            <div className="shrink-0 px-5 pb-5 pt-1">
              <Button
                type="button"
                onClick={handleUseAvatar}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[3px] bg-primary px-4 shadow-sm hover:bg-primary/90"
                disabled={!selectedAvatar || isSettingActive || isGeneratingTryOn}
              >
                <Sparkles className="size-3.5 text-primary-foreground" aria-hidden="true" />
                <span className="text-[12px] font-bold text-primary-foreground">
                  {isGeneratingTryOn ? "Starting…" : "Try on"}
                </span>
              </Button>
              {onManagePoses ? (
                <button
                  type="button"
                  onClick={onManagePoses}
                  className="mt-3 w-full text-center text-[10px] font-semibold text-ink-body"
                >
                  Manage all poses ›
                </button>
              ) : null}
            </div>
          </>
        ) : (
        <>
        <div className="flex-1 min-h-0 overflow-y-auto pb-2 -mr-[10px]">
          <div className="grid grid-cols-2 gap-6 justify-items-center items-stretch pl-1 pr-[10px] py-3 w-full min-h-full">
            {sortedPoses.map((pose) => (
              <div key={pose.id} className="flex flex-col gap-2 items-center relative w-full max-w-[200px]">
                <button
                  type="button"
                  onClick={() => handleSelectAvatar(pose)}
                  className="bg-muted flex flex-col items-end justify-end px-2.5 py-3 relative rounded-[10px] w-full h-full min-h-[160px] transition-all hover:opacity-90"
                >
                  <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[10px]">
                    {pose.imageUrl ? (
                      <img src={pose.imageUrl} alt="neutral pose" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                        preview unavailable
                      </div>
                    )}
                  </div>
                  {selectedAvatar === pose.id ? (
                    <>
                      <div className="pointer-events-none absolute inset-0 rounded-[10px] bg-primary/10" />
                      <div className="pointer-events-none absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                        <Check className="size-3.5" aria-hidden="true" />
                      </div>
                    </>
                  ) : null}
                  <span
                    {...actionChipProps}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (pose.imageUrl) {
                        window.open(pose.imageUrl, "_blank", "noopener,noreferrer")
                      }
                    }}
                    onKeyDown={actionChipProps.onKeyDown((event) => {
                      event.stopPropagation()
                      if (pose.imageUrl) {
                        window.open(pose.imageUrl, "_blank", "noopener,noreferrer")
                      }
                    })}
                  >
                    <Maximize2 className="size-3" aria-hidden="true" />
                    view
                  </span>
                </button>
                <div className="flex flex-row gap-1 items-center justify-center px-0.5 py-0 relative w-full text-center text-xs text-muted-foreground">
                  {savedMode ? (
                    pose.id === savedPoseId ? (
                      <span className="text-primary font-medium">saved</span>
                    ) : (
                      <>
                        <Sparkles className="size-3 shrink-0" />
                        <span>{(() => { const d = new Date(pose.createdAt); return `${d.getDate().toString().padStart(2, "0")}-${d.toLocaleString("default", { month: "short" })}`; })()}</span>
                      </>
                    )
                  ) : pose.isActive ? (
                    <span className="text-primary font-medium">selected</span>
                  ) : (
                    <>
                      <Sparkles className="size-3 shrink-0" />
                      <span>{(() => { const d = new Date(pose.createdAt); return `${d.getDate().toString().padStart(2, "0")}-${d.toLocaleString("default", { month: "short" })}`; })()}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {savedMode ? (
          <CardFooter
            className={`flex gap-2 items-center justify-center pb-6 pt-2.5 px-3 shrink-0 ${
              type === "drawer" ? "border-none shadow-none" : ""
            }`}
          >
            <Button
              type="button"
              onClick={handleGoToStudio}
              className="bg-primary flex flex-1 max-w-[140px] gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm"
            >
              {/* `Share` was referenced here but never imported — this footer
                  threw the moment savedMode rendered. */}
              <Sparkles className="relative shrink-0 size-4 text-primary-foreground" />
              <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">go to studio</p>
            </Button>
          </CardFooter>
        ) : (
          <CardFooter
            className={`flex gap-8 md:gap-16 items-center justify-center pb-8 pt-2.5 px-4 md:px-8 shrink-0 ${
              type === "drawer" ? "border-none shadow-none" : ""
            }`}
          >
            {showUseAvatarButton ? (
              <Button
                type="button"
                onClick={handleUseAvatar}
                className="bg-primary flex flex-1 max-w-[140px] gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm"
                disabled={!selectedAvatar || isSettingActive || isGeneratingTryOn}
              >
                <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">use likeness</p>
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={onGenerateNew}
              className="bg-primary flex flex-1 max-w-[140px] gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm"
            >
              <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">generate new</p>
            </Button>
          </CardFooter>
        )}
        </>
        )}
      </div>
    </Form>
  )
}
