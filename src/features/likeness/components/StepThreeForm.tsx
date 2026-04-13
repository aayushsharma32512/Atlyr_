import { UseFormReturn, useWatch } from "react-hook-form"
import { CardHeader, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { Check, Loader2, Maximize2, Share, Rotate3d } from "lucide-react"
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
        <CardHeader
          className={`flex gap-3 items-center justify-center h-auto p-6 shrink-0 ${
            type === "drawer" ? "border-none shadow-none" : ""
          }`}
        >
          <div className="flex flex-1 flex-col gap-1.5 items-center justify-center text-center">
            <p className="text-base font-medium text-card-foreground leading-none">Select Likeness</p>
            <p className="text-sm font-normal text-muted-foreground leading-5">
              Choose an existing likeness to use for try-on or generate a new one.
            </p>
            {savedMode && !isSavedPoseAvailable ? (
              <span className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted-foreground/10 px-2 py-1 rounded">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading saved likeness...
              </span>
            ) : null}
          </div>
        </CardHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pb-2">
          <div className="grid grid-cols-2 gap-3 justify-items-center items-start px-3 py-3 w-full">
            {sortedPoses.map((pose) => (
              <div key={pose.id} className="flex flex-col gap-2 items-center relative w-full max-w-[200px]">
                <button
                  type="button"
                  onClick={() => handleSelectAvatar(pose)}
                  className="bg-muted flex flex-col items-end justify-end px-2.5 py-3 relative rounded-[10px] w-full aspect-square transition-all hover:opacity-90"
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
                  <p>
                    {savedMode ? (
                      pose.id === savedPoseId ? (
                        <span className="text-primary font-medium">saved</span>
                      ) : (
                        <span>{new Date(pose.createdAt).toLocaleDateString()}</span>
                      )
                    ) : pose.isActive ? (
                      <span className="text-primary font-medium">selected</span>
                    ) : (
                      <span>{new Date(pose.createdAt).toLocaleDateString()}</span>
                    )}
                  </p>
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
              className="bg-primary flex flex-1 gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm"
            >
              <Share className="relative shrink-0 size-4 text-primary-foreground" />
              <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">go to studio</p>
            </Button>
          </CardFooter>
        ) : (
          <CardFooter
            className={`flex gap-2 items-center justify-center pb-6 pt-2.5 px-3 shrink-0 ${
              type === "drawer" ? "border-none shadow-none" : ""
            }`}
          >
            {showUseAvatarButton ? (
              <Button
                type="button"
                onClick={handleUseAvatar}
                className="bg-primary flex flex-1 gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm"
                disabled={!selectedAvatar || isSettingActive || isGeneratingTryOn}
              >
                <Share className="relative shrink-0 size-4 text-primary-foreground" />
                <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">use likeness</p>
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={onGenerateNew}
              className="bg-primary flex flex-1 gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm"
            >
              <Rotate3d className="relative shrink-0 size-4 text-primary-foreground" />
              <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">generate new</p>
            </Button>
          </CardFooter>
        )}
      </div>
    </Form>
  )
}
