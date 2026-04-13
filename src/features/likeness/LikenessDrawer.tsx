import { useCallback, useEffect, useState } from "react"
import { useForm, FormProvider } from "react-hook-form"
import { toast as sonnerToast } from "sonner"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer"
import { Card, CardContent } from "@/components/ui/card"
import { StepOneForm } from "@/features/likeness/components/StepOneForm"
import { StepTwoForm } from "@/features/likeness/components/StepTwoForm"
import { StepThreeForm } from "@/features/likeness/components/StepThreeForm"
import { useLikenessListQuery } from "@/features/likeness/hooks/useLikenessListQuery"
import { useLikenessUploadMutation } from "@/features/likeness/hooks/useLikenessUploadMutation"
import { useLikenessBatchQuery } from "@/features/likeness/hooks/useLikenessBatchQuery"
import { useLikenessSelectMutation } from "@/features/likeness/hooks/useLikenessSelectMutation"
import { useLikenessSetActiveMutation } from "@/features/likeness/hooks/useLikenessSetActiveMutation"
import { useLikenessJobStatus } from "@/features/likeness/hooks/useLikenessJobStatus"
import { useToast } from "@/hooks/use-toast"
import { useEnsureSummaries } from "@/features/tryon/hooks/useEnsureSummaries"
import { useGenerateTryOn } from "@/features/tryon/hooks/useGenerateTryOn"
import { checkTryOnLimit } from "@/services/tryon/tryonService"
import { checkLikenessLimit } from "@/services/likeness/likenessService"
import { useJobs } from "@/features/progress/providers/JobsContext"
import { useAuth } from "@/contexts/AuthContext"
import { buildStudioComboKey } from "@/integrations/posthog/engagementTracking/studio/studioTracking"
import type {
  LikenessFormData,
  LikenessOutfitItemsParam,
  LikenessOutfitSnapshotParam,
  LikenessStep,
} from "./types"

const DEFAULT_STEP: LikenessStep = 1

interface LikenessDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  outfitItems?: LikenessOutfitItemsParam
  outfitSnapshot?: LikenessOutfitSnapshotParam
  initialStep?: LikenessStep
  initialBatchId?: string | null
  entrySource?: "direct" | "fromProgressHub" | "fromStep3"
  initialSavedMode?: boolean
  initialSavedPoseId?: string | null
}

export function LikenessDrawer({
  open,
  onOpenChange,
  outfitItems,
  outfitSnapshot,
  initialStep,
  initialBatchId,
  entrySource = "direct",
  initialSavedMode = false,
  initialSavedPoseId = null,
}: LikenessDrawerProps) {
  const { toast } = useToast()
  const { jobs, addJob, updateJob, removeJob, getJobById } = useJobs()
  const [currentStep, setCurrentStep] = useState<LikenessStep>(initialStep ?? DEFAULT_STEP)
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
  const [timerSeconds, setTimerSeconds] = useState(60)
  const [hasStartedFlow, setHasStartedFlow] = useState(false)
  const [canReturnToStepThree, setCanReturnToStepThree] = useState(false)
  const [savedMode, setSavedMode] = useState(false)
  const [savedPoseId, setSavedPoseId] = useState<string | null>(null)
  const [hasInitialized, setHasInitialized] = useState(false)
  
  const form = useForm<LikenessFormData>({
    mode: "onChange",
    defaultValues: {
      fullBodyPhoto: null,
      faceSelfiePhoto: null,
    },
  })

  const { user } = useAuth()
  const listQuery = useLikenessListQuery({ enabled: !!user })
  const uploadMutation = useLikenessUploadMutation()
  const batchQuery = useLikenessBatchQuery(activeBatchId)
  const selectMutation = useLikenessSelectMutation()
  const setActiveMutation = useLikenessSetActiveMutation()
  const ensureSummariesMutation = useEnsureSummaries()
  const [tempTryonId, setTempTryonId] = useState<string | undefined>()
  const generateTryOnMutation = useGenerateTryOn(tempTryonId)
  const jobState = useLikenessJobStatus({
    uploadStatus: uploadMutation.status,
    selectStatus: selectMutation.status,
    hasSavedPoses: (listQuery.data?.length ?? 0) > 0,
  })

  // Reset form and state when drawer opens/closes
  useEffect(() => {
    if (!open) {
      // Reset state when drawer closes
      setCurrentStep(initialStep ?? DEFAULT_STEP)
      setActiveBatchId(null)
      setHasStartedFlow(false)
      setTimerSeconds(60)
      setCanReturnToStepThree(false)
      setSavedMode(false)
      setSavedPoseId(null)
      setHasInitialized(false)
      form.reset({
        fullBodyPhoto: null,
        faceSelfiePhoto: null,
      })
      return
    }

    if (hasInitialized) {
      return
    }

    // When drawer opens, determine initial step based on saved poses or initialBatchId
    if (initialStep === 3) {
      setCurrentStep(3)
      setActiveBatchId(null)
      setHasStartedFlow(false)
      setCanReturnToStepThree(false)
      setSavedMode(initialSavedMode)
      setSavedPoseId(initialSavedPoseId)
    } else if (initialBatchId) {
      // If batchId is provided, go to step 2 (candidate selection)
      setCurrentStep(2)
      setActiveBatchId(initialBatchId)
      setHasStartedFlow(true)
      setCanReturnToStepThree(false)
      setSavedMode(false)
      setSavedPoseId(null)
    } else if (initialStep) {
      setCurrentStep(initialStep)
      setCanReturnToStepThree(entrySource === "fromStep3" && initialStep === 1)
      setSavedMode(initialSavedMode)
      setSavedPoseId(initialSavedPoseId)
    } else if (listQuery.isSuccess) {
      setCurrentStep((listQuery.data?.length ?? 0) > 0 ? 3 : 1)
      setCanReturnToStepThree(false)
      setSavedMode(false)
      setSavedPoseId(null)
    }

    setHasInitialized(true)
  }, [
    open,
    hasInitialized,
    initialStep,
    initialBatchId,
    listQuery.isSuccess,
    listQuery.data,
    form,
    entrySource,
    initialSavedMode,
    initialSavedPoseId,
  ])

  useEffect(() => {
    if (!hasStartedFlow) {
      return
    }
    if (uploadMutation.isPending) {
      setTimerSeconds(60)
      const id = setInterval(() => {
        setTimerSeconds((prev) => (prev > 0 ? prev - 1 : 0))
      }, 1000)
      return () => clearInterval(id)
    }
    setTimerSeconds(0)
  }, [hasStartedFlow, uploadMutation.isPending])

  const updateStep = useCallback(
    (next: LikenessStep) => {
      setCurrentStep(next)
    },
    [],
  )

  const handlePrevious = useCallback(() => {
    if (currentStep > 1) {
      updateStep((currentStep - 1) as LikenessStep)
    }
  }, [currentStep, updateStep])

  const handleGenerateLikeness = useCallback(async () => {
    // Add job to JobsContext IMMEDIATELY to prevent rapid-click race condition
    const tempId = `temp-likeness-${Date.now()}`
    addJob({
      id: tempId,
      type: "likeness",
      status: "processing",
      progress: 0,
      metadata: { batchId: tempId },
    })

    // Count pending likeness jobs (now includes the one we just added)
    const pendingLikenessJobs = jobs.filter(
      (j) => j.type === "likeness" && j.status === "processing"
    ).length + 1 // +1 for the job we just added (not yet in jobs array)

    // Check likeness limit
    try {
      const limitCheck = await checkLikenessLimit(pendingLikenessJobs)
      if (!limitCheck.allowed) {
        removeJob(tempId)
        toast({
          title: "Generation limit reached",
          description: `You have used all ${limitCheck.limit} likeness generations today.`,
          variant: "destructive",
        })
        return
      }
    } catch (err) {
      console.error("Failed to check likeness limit:", err)
      // Continue anyway - edge function will enforce the limit
    }

    const values = form.getValues()
    if (!values.fullBodyPhoto || !values.faceSelfiePhoto) {
      removeJob(tempId)
      toast({
        title: "Missing photos",
        description: "Please upload both a full body photo and a selfie.",
        variant: "destructive",
      })
      return
    }
    try {
      setHasStartedFlow(true)
      
      // Capture outfit parameters from props
      const outfitParams = {
        topId: outfitItems?.topId ?? null,
        bottomId: outfitItems?.bottomId ?? null,
        footwearId: outfitItems?.footwearId ?? null,
        outfitId: outfitSnapshot?.id ?? null,
        outfitName: outfitSnapshot?.name ?? null,
        outfitCategory: outfitSnapshot?.category ?? null,
        outfitOccasion: outfitSnapshot?.occasionId ?? null,
        outfitBackgroundId: outfitSnapshot?.backgroundId ?? null,
        outfitGender: outfitSnapshot?.gender ?? null,
        returnTo: null,
      }
      
      // Update the temp job we created earlier with outfit params
      updateJob(tempId, {
        metadata: { 
          batchId: tempId, 
          outfitParams,
          expectedCount: 2, // We expect 2 candidates
        },
      })
      
      // Show background generation toast
      sonnerToast.info("Generating avatar in background...", {
        description: "You can continue browsing. We'll notify you when ready.",
        duration: 4000,
      })
      
      const response = await uploadMutation.mutateAsync({
        fullBody: values.fullBodyPhoto,
        selfie: values.faceSelfiePhoto,
        candidateCount: 2,
        parallelStreams: 2,
      })
      setActiveBatchId(response.uploadBatchId)
      
      // Update temp job with real batchId from response
      updateJob(tempId, {
        id: response.uploadBatchId,
        metadata: { 
          batchId: response.uploadBatchId, 
          outfitParams,
          expectedCount: 2,
        },
      })

      // Close drawer once upload is submitted (background generation continues)
      onOpenChange(false)
    } catch (error) {
      removeJob(tempId)
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unable to generate likeness.",
        variant: "destructive",
      })
    }
  }, [jobs, form, toast, uploadMutation, updateStep, addJob, removeJob, updateJob, outfitItems, outfitSnapshot])

  const handleSaveCandidate = useCallback(
    async (candidateId: string) => {
      if (!candidateId) {
        toast({
          title: "No candidate selected",
          description: "Please select a candidate first.",
          variant: "destructive",
        })
        return
      }
      try {
        const selection = await selectMutation.mutateAsync({
          candidateId,
          setActive: true,
        })
        if (activeBatchId) {
          const job = getJobById(activeBatchId)
          const savedPose = selection?.neutralPoseId ?? null
          updateJob(activeBatchId, {
            status: "ready",
            metadata: {
              ...(job?.metadata ?? {}),
              saved: true,
              savedPoseId: savedPose,
            },
          })
        }
        setActiveBatchId(null)
        form.reset({
          fullBodyPhoto: null,
          faceSelfiePhoto: null,
        })
        setSavedMode(true)
        setSavedPoseId(selection?.neutralPoseId ?? null)
        updateStep(3)
      } catch (error) {
        toast({
          title: "Save failed",
          description: error instanceof Error ? error.message : "Unable to save the selected candidate.",
          variant: "destructive",
        })
      }
    },
    [activeBatchId, form, getJobById, selectMutation, toast, updateJob, updateStep],
  )

  const handleGenerateNew = useCallback(() => {
    setActiveBatchId(null)
    form.reset({
      fullBodyPhoto: null,
      faceSelfiePhoto: null,
    })
    setCanReturnToStepThree(true)
    setSavedMode(false)
    setSavedPoseId(null)
    updateStep(1)
  }, [form, updateStep])

  const handleBackToStepThree = useCallback(() => {
    setActiveBatchId(null)
    form.reset({
      fullBodyPhoto: null,
      faceSelfiePhoto: null,
    })
    setCanReturnToStepThree(false)
    setSavedMode(false)
    setSavedPoseId(null)
    updateStep(3)
  }, [form, updateStep])

  const handleSetActivePose = useCallback(
    (poseId: string) => {
      setActiveMutation.mutate(poseId, {
        onError: (error) =>
          toast({
            title: "Failed to set active pose",
            description: error.message,
            variant: "destructive",
          }),
      })
    },
    [setActiveMutation, toast],
  )

  const handleUseAvatar = useCallback(
    async (poseId: string) => {
      // Add job to JobsContext IMMEDIATELY to prevent rapid-click race condition
      // Other clicks will see this job in the pending count
      const tempId = `temp-tryon-${Date.now()}`
      addJob({
        id: tempId,
        type: "tryon",
        status: "processing",
        progress: 0,
        metadata: { generationId: tempId },
      })

      // Count pending tryon jobs (now includes the one we just added)
      const pendingTryonJobs = jobs.filter(
        (j) => j.type === "tryon" && j.status === "processing"
      ).length + 1 // +1 for the job we just added (not yet in jobs array)

      // Check limit
      try {
        const limitCheck = await checkTryOnLimit(pendingTryonJobs)
        if (!limitCheck.allowed) {
          // Remove the job we just added since we're not proceeding
          removeJob(tempId)
          toast({
            title: "Generation limit reached",
            description: `You have used all ${limitCheck.limit} try-on generations today.`,
            variant: "destructive",
          })
          return
        }
      } catch (err) {
        console.error("Failed to check try-on limit:", err)
        // Continue anyway - edge function will enforce the limit
      }

      const { topId, bottomId, footwearId } = outfitItems ?? {}

      if (!topId && !bottomId && !footwearId) {
        removeJob(tempId)
        toast({
          title: "No outfit items",
          description: "Select at least one garment in Studio before starting a try-on.",
          variant: "destructive",
        })
        return
      }

      const outfitItemsFromProps = {
        topId,
        bottomId,
        footwearId,
      }

      const outfitSnapshotFromProps = outfitSnapshot
        ? {
            id: outfitSnapshot.id,
            name: outfitSnapshot.name ?? null,
            category: outfitSnapshot.category ?? null,
            occasion: outfitSnapshot.occasionId ?? null,
            background_id: outfitSnapshot.backgroundId ?? null,
            gender: outfitSnapshot.gender ?? null,
            top_id: topId ?? null,
            bottom_id: bottomId ?? null,
            shoes_id: footwearId ?? null,
          }
        : undefined

      try {
        // Update the temp job we created earlier with comboKey
        setTempTryonId(tempId)
        const tryonPayload = {
          neutralPoseId: poseId,
          outfitItems: outfitItemsFromProps,
          outfitSnapshot: outfitSnapshotFromProps,
        }
        const comboKey = buildStudioComboKey({
          slotIds: {
            topId: topId ?? null,
            bottomId: bottomId ?? null,
            shoesId: footwearId ?? null,
          },
          hiddenSlots: { top: false, bottom: false, shoes: false },
        })
        updateJob(tempId, {
          metadata: { generationId: tempId, comboKey, tryonPayload },
        })

        // Show background generation toast immediately
        sonnerToast.info("Starting try-on generation...", {
          description: "Continue browsing. We'll notify you when it's ready.",
          duration: 4000,
        })

        onOpenChange(false)
        await setActiveMutation.mutateAsync(poseId)
        await ensureSummariesMutation.mutateAsync([topId, bottomId, footwearId])
        await generateTryOnMutation.mutateAsync({
          neutralPoseId: poseId,
          outfitItems: outfitItemsFromProps,
          outfitSnapshot: outfitSnapshotFromProps,
        })
      } catch (error) {
        toast({
          title: "Try-on failed",
          description: error instanceof Error ? error.message : "Unable to start try-on.",
          variant: "destructive",
        })
        // Remove the temp job on error
        removeJob(tempId)
      }
    },
    [
      jobs,
      outfitItems,
      outfitSnapshot,
      toast,
      addJob,
      removeJob,
      updateJob,
      setActiveMutation,
      ensureSummariesMutation,
      generateTryOnMutation,
      onOpenChange,
    ],
  )

  const statusLabel =
    currentStep === 3
      ? "saved"
      : currentStep === 2
        ? "review"
        : uploadMutation.isPending
          ? "generating"
          : jobState === "error"
            ? "error"
            : "generating"

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] w-[97%] max-w-[600px] mx-auto flex flex-col">
        <DrawerTitle className="sr-only">Likeness drawer</DrawerTitle>
        <DrawerDescription className="sr-only">
          Upload and select likeness photos to generate or set your avatar.
        </DrawerDescription>
        <FormProvider {...form}>
          <div className="flex flex-col flex-1 min-h-0 bg-background px-2.5 pt-2.5 pb-2.5">
            <Card className="border-none shadow-none flex flex-col flex-1 min-h-0 rounded-[18px] w-full max-w-[600px] mx-auto">
              <CardContent className="flex w-full flex-col flex-1 min-h-0 p-0">
                {currentStep === 1 && (
                  <StepOneForm
                    type="drawer"
                    form={form}
                    onGenerate={handleGenerateLikeness}
                    showBack={canReturnToStepThree}
                    onBack={handleBackToStepThree}
                    isBackDisabled={uploadMutation.isPending}
                  />
                )}
                {currentStep === 2 && (
                  <StepTwoForm
                    type="drawer"
                    form={form}
                    candidates={(batchQuery.data ?? []).map(c => ({
                      index: c.candidateIndex,
                      candidateId: c.id,
                      path: c.storagePath,
                      signedUrl: c.signedUrl,
                      summary: c.identitySummary,
                    }))}
                    onPrevious={() => {
                      setActiveBatchId(null)
                      handlePrevious()
                    }}
                    onSave={handleSaveCandidate}
                    isSaving={selectMutation.isPending}
                    viewMode="grid"
                    showBack={false}
                  />
                )}
                {currentStep === 3 && (
                  <StepThreeForm
                    type="drawer"
                    form={form}
                    poses={listQuery.data ?? []}
                    onGenerateNew={handleGenerateNew}
                    onUseAvatar={handleUseAvatar}
                    onSetActive={handleSetActivePose}
                    isSettingActive={setActiveMutation.isPending}
                    isGeneratingTryOn={ensureSummariesMutation.isPending || generateTryOnMutation.isPending}
                    savedMode={savedMode}
                    savedPoseId={savedPoseId}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </FormProvider>
      </DrawerContent>
    </Drawer>
  )
}
