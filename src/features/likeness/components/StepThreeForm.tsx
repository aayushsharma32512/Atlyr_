import { UseFormReturn, useWatch } from "react-hook-form"
import { CardHeader, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { Check, Loader2, Maximize2, Sparkles } from "lucide-react"
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
}: StepThreeFormProps) {
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
              <Share className="relative shrink-0 size-4 text-primary-foreground" />
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
      </div>
    </Form>
  )
}
