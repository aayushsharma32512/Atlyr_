import { useNavigate } from "react-router-dom"
import { useForm } from "react-hook-form"

import { useAuth } from "@/contexts/AuthContext"
import { ScreenHeader } from "@/design-system/primitives"
import { StepThreeForm } from "@/features/likeness/components/StepThreeForm"
import { useLikenessListQuery } from "@/features/likeness/hooks/useLikenessListQuery"
import { useLikenessSetActiveMutation } from "@/features/likeness/hooks/useLikenessSetActiveMutation"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import type { LikenessFormData } from "@/features/likeness/types"
import { useToast } from "@/hooks/use-toast"
import { AppShellLayout } from "@/layouts/AppShellLayout"

export function AvatarPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const startLikenessFlow = useStartLikenessFlow()
  const setActiveMutation = useLikenessSetActiveMutation()
  const listQuery = useLikenessListQuery({ enabled: !!user })
  const form = useForm<LikenessFormData>({
    mode: "onChange",
    defaultValues: {
      fullBodyPhoto: null,
      faceSelfiePhoto: null,
    },
  })

  const handleBack = () => {
    navigate("/profile")
  }

  const handleGenerateNew = () => {
    startLikenessFlow({ initialStep: 1 })
  }

  const handleSetActive = (poseId: string) => {
    setActiveMutation.mutate(poseId, {
      onError: (error) =>
        toast({
          title: "Failed to set active pose",
          description: error.message,
          variant: "destructive",
        }),
    })
  }

  return (
    <AppShellLayout>
      <div className="relative flex flex-1 flex-col min-h-0 bg-background">
        <ScreenHeader
          onAction={handleBack}
          className="absolute left-4 top-4 z-20 px-0 pt-0 pb-0"
        />
        <div className="flex flex-1 flex-col min-h-0">
          <StepThreeForm
            type="screen"
            form={form}
            poses={listQuery.data ?? []}
            onGenerateNew={handleGenerateNew}
            onSetActive={handleSetActive}
            isSettingActive={setActiveMutation.isPending}
            showUseAvatarButton={false}
          />
        </div>
      </div>
    </AppShellLayout>
  )
}

export default AvatarPage
