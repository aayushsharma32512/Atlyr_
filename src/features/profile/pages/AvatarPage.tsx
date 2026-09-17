import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronLeft } from "lucide-react"

import { useAuth } from "@/contexts/AuthContext"
import { LikenessGallery } from "@/features/likeness/components/LikenessGallery"
import { useLikenessListQuery } from "@/features/likeness/hooks/useLikenessListQuery"
import { useLikenessSetActiveMutation } from "@/features/likeness/hooks/useLikenessSetActiveMutation"
import { useLikenessDeleteMutation } from "@/features/likeness/hooks/useLikenessDeleteMutation"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import { checkLikenessLimit } from "@/services/likeness/likenessService"
import { useToast } from "@/hooks/use-toast"
import { AppShellLayout } from "@/layouts/AppShellLayout"

/** The likeness gallery, on the same light grammar as the profile page. */
export function AvatarPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const startLikenessFlow = useStartLikenessFlow()
  const setActiveMutation = useLikenessSetActiveMutation()
  const deleteMutation = useLikenessDeleteMutation()
  const listQuery = useLikenessListQuery({ enabled: !!user })

  // The daily meter is read once on mount rather than polled — it only moves
  // when *you* generate, and this screen is where you'd do that.
  const [limit, setLimit] = useState<{ count: number; limit: number } | null>(null)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    checkLikenessLimit()
      .then((result) => {
        if (!cancelled) setLimit({ count: result.count, limit: result.limit })
      })
      .catch(() => {
        // The meter is informational; the edge function enforces the real cap.
      })
    return () => {
      cancelled = true
    }
  }, [user])

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

  const handleDelete = (poseId: string) => {
    deleteMutation.mutate(poseId, {
      onError: (error) =>
        toast({
          title: "Could not delete pose",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
    })
  }

  return (
    <AppShellLayout>
      <div className="min-h-[calc(100dvh-55px)] bg-background text-foreground">
        <div className="mx-auto w-full max-w-lg px-5 pb-10 pt-4 sm:px-6">
          <button
            type="button"
            onClick={handleBack}
            className="-ml-1 flex min-h-10 items-center gap-1 pr-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Profile
          </button>

          <header className="mt-2 px-1">
            <h1 className="font-display text-[34px] font-medium leading-none tracking-[-0.025em] text-foreground sm:text-[38px]">
              Your likenesses
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The active pose is the one every try-on uses.
            </p>
          </header>

          <LikenessGallery
            className="mt-6"
            poses={listQuery.data ?? []}
            onSetActive={handleSetActive}
            onDelete={handleDelete}
            onGenerateNew={handleGenerateNew}
            remainingToday={limit ? Math.max(0, limit.limit - limit.count) : null}
            isBusy={setActiveMutation.isPending || deleteMutation.isPending}
          />
        </div>
      </div>
    </AppShellLayout>
  )
}

export default AvatarPage
