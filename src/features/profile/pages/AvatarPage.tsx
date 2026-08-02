import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronLeft } from "lucide-react"

import { useAuth } from "@/contexts/AuthContext"
import { IconButton } from "@/design-system/primitives"
import { LikenessGallery } from "@/features/likeness/components/LikenessGallery"
import { useLikenessListQuery } from "@/features/likeness/hooks/useLikenessListQuery"
import { useLikenessSetActiveMutation } from "@/features/likeness/hooks/useLikenessSetActiveMutation"
import { useLikenessDeleteMutation } from "@/features/likeness/hooks/useLikenessDeleteMutation"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import { checkLikenessLimit } from "@/services/likeness/likenessService"
import { useToast } from "@/hooks/use-toast"
import { AppShellLayout } from "@/layouts/AppShellLayout"

/** Canvas 6o2 — the likeness gallery. */
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
      {/* The darkroom fills the viewport, but the CONTENT is a phone column —
          same treatment as the studio. Without the cap, `grid-cols-2` on a
          laptop gives ~950px cells and the aspect-[3/4] tiles become 1200px
          tall, which is the giant empty box. */}
      <div className="flex min-h-0 flex-1 justify-center bg-ink-deepest">
        <div className="flex min-h-0 w-full max-w-sm flex-1 flex-col md:max-w-md">
        <header className="flex shrink-0 items-center px-3 pt-2">
          <IconButton
            tone="ghost"
            size="xs"
            aria-label="Back"
            onClick={handleBack}
            className="text-on-ink-2 hover:text-on-ink-1"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </IconButton>
          <h1 className="flex-1 text-center font-display text-[17px] font-medium text-on-ink-1">
            Your likenesses
          </h1>
          <span className="size-7 shrink-0" aria-hidden="true" />
        </header>

        <LikenessGallery
          className="pt-3"
          poses={listQuery.data ?? []}
          onSetActive={handleSetActive}
          onDelete={handleDelete}
          onGenerateNew={handleGenerateNew}
          // Goes to the studio rather than starting a generation. A try-on needs
          // an outfit to put on the pose, and this screen has none — the active
          // pose IS what a studio try-on will use, so this is the honest door.
          onTryOn={() => navigate("/studio")}
          remainingToday={limit ? Math.max(0, limit.limit - limit.count) : null}
          dailyLimit={limit?.limit ?? null}
          isBusy={setActiveMutation.isPending || deleteMutation.isPending}
        />
        </div>
      </div>
    </AppShellLayout>
  )
}

export default AvatarPage
