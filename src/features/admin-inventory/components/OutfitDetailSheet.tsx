import { toast } from "sonner"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { useCandidateComposite } from "@/features/outfit-screener-review/hooks/useCandidateComposite"
import type { ReviewQueueOutfit } from "@/services/admin-inventory/outfitReviewService"
import { useReviewOutfit } from "../hooks/useReviewOutfit"
import { useRestoreOutfit } from "../hooks/useRestoreOutfit"

interface OutfitDetailSheetProps {
    outfit: ReviewQueueOutfit | null
    categoryName?: string
    /** Which segment the outfit was opened from — Active shows Hide, Hidden shows Unhide. */
    visible: boolean
    onClose: () => void
}

/** Full composite preview plus the single reversible action for the segment it was opened from. */
export function OutfitDetailSheet({ outfit, categoryName, visible, onClose }: OutfitDetailSheetProps) {
    const composite = useCandidateComposite(
        outfit?.top_id ?? null,
        outfit?.bottom_id ?? null,
        outfit?.shoes_id ?? null,
    )
    const reviewMutation = useReviewOutfit()
    const restoreMutation = useRestoreOutfit()

    const handleAction = () => {
        if (!outfit) return

        if (visible) {
            reviewMutation.mutate(
                { outfitId: outfit.id, decision: "hide" },
                {
                    onSuccess: () => {
                        toast.success("Hidden")
                        onClose()
                    },
                },
            )
        } else {
            restoreMutation.mutate(outfit.id, {
                onSuccess: () => onClose(),
            })
        }
    }

    return (
        <Sheet
            open={Boolean(outfit)}
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
        >
            <SheetContent side="bottom" className="mx-auto max-w-sm rounded-t-xl">
                {outfit ? (
                    <div className="flex flex-col gap-4">
                        <SheetHeader>
                            <SheetTitle>{outfit.name}</SheetTitle>
                            <SheetDescription>
                                {categoryName ?? outfit.category} · {new Date(outfit.created_at).toLocaleDateString()}
                            </SheetDescription>
                        </SheetHeader>

                        <div className="mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-lg border border-border bg-muted/10">
                            {composite.isLoading ? (
                                <div className="flex h-full w-full items-center justify-center">
                                    <LoadingSpinner />
                                </div>
                            ) : composite.error ? (
                                <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-destructive">
                                    Failed to render preview: {composite.error.message}
                                </div>
                            ) : (
                                <OutfitInspirationTile
                                    preset="heroCanonical"
                                    renderedItems={composite.data?.renderedItems ?? []}
                                    avatarGender={composite.data?.avatarGender ?? "female"}
                                    allowEmptyMannequin
                                    wrapperClassName="h-full w-full"
                                    cardClassName="h-full w-full"
                                />
                            )}
                        </div>

                        <Button
                            size="lg"
                            variant="outline"
                            className={
                                visible
                                    ? "border-2 border-violet bg-white text-foreground hover:bg-white active:bg-violet/10"
                                    : "border-2 border-ink bg-white text-foreground hover:bg-white active:bg-ink/10"
                            }
                            disabled={reviewMutation.isPending || restoreMutation.isPending}
                            onClick={handleAction}
                        >
                            {visible ? "Hide" : "Unhide"}
                        </Button>
                    </div>
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
