import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { motion, animate, useMotionValue, type PanInfo } from "framer-motion"
import { CheckCircle, XCircle } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { fetchCandidateComposite } from "@/services/outfit-screener-review/candidateCompositeService"
import { useCandidateComposite } from "@/features/outfit-screener-review/hooks/useCandidateComposite"
import { outfitScreenerQueryKeys } from "@/features/outfit-screener-review/queryKeys"
import type { ReviewQueueOutfit } from "@/services/admin-inventory/outfitReviewService"

import { useOutfitCategories } from "../hooks/useOutfitCategories"
import { useReviewQueue } from "../hooks/useReviewQueue"
import { useReviewOutfit } from "../hooks/useReviewOutfit"

// Same thresholds as the outfit screener's swipe queue.
const SWIPE_OFFSET_THRESHOLD = 120
const SWIPE_VELOCITY_THRESHOLD = 600
const EXIT_DISTANCE = 480
const EXIT_TRANSITION = { duration: 0.25, ease: "easeOut" } as const
const RETURN_TRANSITION = { type: "spring", stiffness: 420, damping: 34 } as const

/** Keep/hide queue for outfits pending review, filterable by category. */
export function OutfitReviewQueue() {
    const queryClient = useQueryClient()
    const [categoryId, setCategoryId] = useState<string | null>(null)
    const { data: categories } = useOutfitCategories()
    const {
        data: queuePages,
        isLoading,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useReviewQueue(categoryId)
    const outfits = useMemo(() => (queuePages?.pages ?? []).flatMap((page) => page.rows), [queuePages])
    const reviewMutation = useReviewOutfit()

    const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
    const submittedIdsRef = useRef<Set<string>>(new Set())
    const cardX = useMotionValue(0)
    const [isExiting, setIsExiting] = useState(false)

    useEffect(() => {
        setRemovedIds(new Set())
        submittedIdsRef.current = new Set()
        cardX.set(0)
        setIsExiting(false)
    }, [categoryId, cardX])

    const remaining = useMemo(
        () => (outfits ?? []).filter((outfit) => !removedIds.has(outfit.id)),
        [outfits, removedIds],
    )
    const current = remaining[0] ?? null
    const next = remaining[1] ?? null

    // Top up the queue before the swipe stack runs dry.
    useEffect(() => {
        if (remaining.length < 5 && hasNextPage && !isFetchingNextPage) {
            fetchNextPage()
        }
    }, [remaining.length, hasNextPage, isFetchingNextPage, fetchNextPage])

    const composite = useCandidateComposite(
        current?.top_id ?? null,
        current?.bottom_id ?? null,
        current?.shoes_id ?? null,
    )

    // Warm the cache for the next card so advancing rarely shows a loading flash.
    useEffect(() => {
        if (!next || !next.top_id || !next.bottom_id || !next.shoes_id) return
        queryClient.prefetchQuery({
            queryKey: outfitScreenerQueryKeys.composite(next.top_id, next.bottom_id, next.shoes_id),
            queryFn: () => fetchCandidateComposite(next.top_id as string, next.bottom_id as string, next.shoes_id as string),
            staleTime: 5 * 60_000,
        })
    }, [next, queryClient])

    const commitDecision = (
        decision: "keep" | "hide",
        outfit: ReviewQueueOutfit,
        source: "tap" | "swipe",
    ) => {
        const outfitId = outfit.id
        if (submittedIdsRef.current.has(outfitId)) return
        submittedIdsRef.current.add(outfitId)

        reviewMutation.mutate(
            { outfitId, decision },
            {
                onError: () => {
                    submittedIdsRef.current.delete(outfitId)
                    setRemovedIds((prev) => {
                        const set = new Set(prev)
                        set.delete(outfitId)
                        return set
                    })
                },
            },
        )

        if (source === "tap") {
            toast.success(decision === "keep" ? "Kept" : "Hidden")
        }

        setIsExiting(true)
        const exitTarget = decision === "keep" ? EXIT_DISTANCE : -EXIT_DISTANCE
        animate(cardX, exitTarget, EXIT_TRANSITION).then(() => {
            setRemovedIds((prev) => new Set(prev).add(outfitId))
            cardX.set(0)
            setIsExiting(false)
        })
    }

    const handleDragEnd = (_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
        if (!current || isExiting) return
        const pastOffset = Math.abs(info.offset.x) > SWIPE_OFFSET_THRESHOLD
        const pastVelocity = Math.abs(info.velocity.x) > SWIPE_VELOCITY_THRESHOLD
        if (pastOffset || pastVelocity) {
            commitDecision(info.offset.x > 0 ? "keep" : "hide", current, "swipe")
        } else {
            animate(cardX, 0, RETURN_TRANSITION)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            {categories && categories.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setCategoryId(null)}
                        className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium",
                            categoryId === null
                                ? "border-violet bg-violet/10 text-violet"
                                : "border-hairline text-muted-foreground",
                        )}
                    >
                        All
                    </button>
                    {categories.map((category) => (
                        <button
                            key={category.id}
                            type="button"
                            onClick={() => setCategoryId(category.id)}
                            className={cn(
                                "rounded-full border px-3 py-1 text-xs font-medium",
                                categoryId === category.id
                                    ? "border-violet bg-violet/10 text-violet"
                                    : "border-hairline text-muted-foreground",
                            )}
                        >
                            {category.name}
                        </button>
                    ))}
                </div>
            ) : null}

            <div className="flex items-center justify-end">
                <span className="text-xs text-muted-foreground">{remaining.length} remaining</span>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <LoadingSpinner />
                </div>
            ) : error ? (
                <div className="py-12 text-center text-destructive">Failed to load queue: {error.message}</div>
            ) : !current ? (
                <div className="py-16 text-center text-muted-foreground">All outfits reviewed.</div>
            ) : (
                <>
                    <motion.div
                        className="mx-auto aspect-[3/4] w-full max-w-sm touch-pan-y overflow-hidden rounded-lg border border-border bg-muted/10"
                        style={{ x: cardX }}
                        drag={isExiting ? false : "x"}
                        onDragEnd={handleDragEnd}
                    >
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
                    </motion.div>

                    <p className="text-center text-sm font-medium text-foreground">{current.name}</p>

                    <div className="grid grid-cols-2 gap-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                        <Button
                            size="lg"
                            variant="outline"
                            className="border-2 border-violet bg-white text-foreground hover:bg-white active:bg-violet/10"
                            disabled={isExiting}
                            onClick={() => current && commitDecision("hide", current, "tap")}
                        >
                            <XCircle className="mr-2 h-5 w-5" />
                            Hide
                        </Button>
                        <Button
                            size="lg"
                            variant="outline"
                            className="border-2 border-ink bg-white text-foreground hover:bg-white active:bg-ink/10"
                            disabled={isExiting}
                            onClick={() => current && commitDecision("keep", current, "tap")}
                        >
                            <CheckCircle className="mr-2 h-5 w-5" />
                            Keep
                        </Button>
                    </div>
                </>
            )}
        </div>
    )
}
