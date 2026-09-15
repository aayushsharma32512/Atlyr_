import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { motion, animate, useMotionValue, type PanInfo } from "framer-motion"
import { ChevronLeft, CheckCircle, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { fetchCandidateComposite } from "@/services/outfit-screener-review/candidateCompositeService"
import type { OutfitCandidatePair, CandidateDecision } from "@/services/outfit-screener-review/candidatePairsService"

import { outfitScreenerQueryKeys } from "../queryKeys"
import { useCandidateTheme } from "../hooks/useCandidateTheme"
import { usePendingCandidates } from "../hooks/usePendingCandidates"
import { useCandidateComposite } from "../hooks/useCandidateComposite"
import { useFootwearProducts } from "../hooks/useFootwearProducts"
import { useDecideCandidate } from "../hooks/useDecideCandidate"
import { useSetPairShoesOverride } from "../hooks/useSetPairShoesOverride"
import { ThemeShoeControl } from "./ThemeShoeControl"
import { PairShoeOverride } from "./PairShoeOverride"

interface ThemeQueueViewProps {
    themeId: string
    onBack: () => void
}

function effectiveShoesFor(pair: OutfitCandidatePair, themeChosenShoesId: string | undefined): string | null {
    if (pair.shoes_override_id) return pair.shoes_override_id
    return themeChosenShoesId ?? null
}

// Drag past this offset (px) or flick past this velocity (px/s) commits the
// swipe; short of both, the card springs back to center.
const SWIPE_OFFSET_THRESHOLD = 120
const SWIPE_VELOCITY_THRESHOLD = 600
// Clears the card's own max-w-sm frame with room to spare on any phone.
const EXIT_DISTANCE = 480
const EXIT_TRANSITION = { duration: 0.25, ease: "easeOut" } as const
const RETURN_TRANSITION = { type: "spring", stiffness: 420, damping: 34 } as const

/**
 * One theme's review queue. Shows the best-remaining pair as a live
 * composite; a swipe or a button tap decides it, the card animates off in
 * that direction, and the next pair takes its place. The RPC call and the
 * queue refresh happen in the background so the tap-through loop never
 * waits on the network.
 */
export function ThemeQueueView({ themeId, onBack }: ThemeQueueViewProps) {
    const queryClient = useQueryClient()
    const { data: theme, isLoading: themeLoading } = useCandidateTheme(themeId)
    const { data: pairs, isLoading: pairsLoading, error: pairsError } = usePendingCandidates(themeId)
    const decideMutation = useDecideCandidate(themeId)
    const overrideMutation = useSetPairShoesOverride(themeId)

    // Pairs the reviewer has already decided in this session, removed from the
    // queue once the exit animation finishes rather than waiting on the server.
    const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
    // Guards against a double-tap/double-swipe firing decide_outfit_candidate
    // twice for the same pair before its exit animation clears it from the queue.
    const submittedIdsRef = useRef<Set<string>>(new Set())
    // Horizontal position of the current composite card; driven by drag and,
    // for a button tap, by the imperative exit animation below.
    const cardX = useMotionValue(0)
    const [isExiting, setIsExiting] = useState(false)

    useEffect(() => {
        setRemovedIds(new Set())
        submittedIdsRef.current = new Set()
        cardX.set(0)
        setIsExiting(false)
    }, [themeId, cardX])

    const remainingPairs = useMemo(
        () => (pairs ?? []).filter((pair) => !removedIds.has(pair.id)),
        [pairs, removedIds],
    )
    const currentPair = remainingPairs[0] ?? null
    const nextPair = remainingPairs[1] ?? null

    const footwearOptions = useMemo(() => theme?.footwear_options ?? [], [theme])
    const shoesIds = useMemo(() => footwearOptions.map((option) => option.shoes_id), [footwearOptions])
    const { data: footwearProducts } = useFootwearProducts(themeId, shoesIds)

    const effectiveShoesId = currentPair ? effectiveShoesFor(currentPair, theme?.chosen_shoes_id) : null
    const composite = useCandidateComposite(
        currentPair?.top_id ?? null,
        currentPair?.bottom_id ?? null,
        effectiveShoesId,
    )

    // Warm the cache for the next pair so advancing rarely shows a loading flash.
    useEffect(() => {
        if (!nextPair) return
        const nextShoesId = effectiveShoesFor(nextPair, theme?.chosen_shoes_id)
        if (!nextShoesId) return
        queryClient.prefetchQuery({
            queryKey: outfitScreenerQueryKeys.composite(nextPair.top_id, nextPair.bottom_id, nextShoesId),
            queryFn: () => fetchCandidateComposite(nextPair.top_id, nextPair.bottom_id, nextShoesId),
            staleTime: 5 * 60_000,
        })
    }, [nextPair, theme?.chosen_shoes_id, queryClient])

    // Single path for both a button tap and a swipe: persists the decision in
    // the background, then plays the same off-screen exit before the queue
    // actually advances. A tap also gets a toast — a swipe's own motion is
    // feedback enough.
    const commitDecision = (
        decision: CandidateDecision,
        pair: OutfitCandidatePair,
        source: "tap" | "swipe",
    ) => {
        const candidateId = pair.id
        if (submittedIdsRef.current.has(candidateId)) return
        submittedIdsRef.current.add(candidateId)

        decideMutation.mutate(
            { candidateId, decision },
            {
                onError: () => {
                    submittedIdsRef.current.delete(candidateId)
                    setRemovedIds((prev) => {
                        const next = new Set(prev)
                        next.delete(candidateId)
                        return next
                    })
                },
            },
        )

        if (source === "tap") {
            toast.success(decision === "accepted" ? "Accepted" : "Rejected")
        }

        setIsExiting(true)
        const exitTarget = decision === "accepted" ? EXIT_DISTANCE : -EXIT_DISTANCE
        animate(cardX, exitTarget, EXIT_TRANSITION).then(() => {
            setRemovedIds((prev) => new Set(prev).add(candidateId))
            cardX.set(0)
            setIsExiting(false)
        })
    }

    const handleDragEnd = (_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
        if (!currentPair || isExiting) return
        const pastOffset = Math.abs(info.offset.x) > SWIPE_OFFSET_THRESHOLD
        const pastVelocity = Math.abs(info.velocity.x) > SWIPE_VELOCITY_THRESHOLD
        if (pastOffset || pastVelocity) {
            commitDecision(info.offset.x > 0 ? "accepted" : "rejected", currentPair, "swipe")
        } else {
            animate(cardX, 0, RETURN_TRANSITION)
        }
    }

    const handleOverride = (shoesId: string | null) => {
        if (!currentPair) return
        overrideMutation.mutate({ candidateId: currentPair.id, shoesId })
    }

    return (
        <div className="flex flex-1 flex-col gap-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
            <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Themes
                </Button>
                <span className="text-sm font-medium text-foreground">{theme?.theme_name ?? "…"}</span>
                <span className="text-xs text-muted-foreground">{remainingPairs.length} pending</span>
            </div>

            {theme && footwearProducts ? (
                <div className="flex justify-center">
                    <ThemeShoeControl theme={theme} footwearProducts={footwearProducts} />
                </div>
            ) : null}

            {pairsLoading || themeLoading ? (
                <div className="flex items-center justify-center py-12">
                    <LoadingSpinner />
                </div>
            ) : pairsError ? (
                <div className="py-12 text-center text-destructive">
                    Failed to load queue: {pairsError.message}
                </div>
            ) : !currentPair ? (
                <div className="py-16 text-center text-muted-foreground">
                    All pairs reviewed in this theme.
                </div>
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

                    <PairShoeOverride
                        pair={currentPair}
                        footwearOptions={footwearOptions}
                        footwearProducts={footwearProducts ?? []}
                        onOverride={handleOverride}
                    />

                    {/* Sits where the app's tab bar normally does — this page hides it via
                        hideNav so the whole bottom edge belongs to the decision itself. */}
                    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-background/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur">
                        <div className="mx-auto grid max-w-sm grid-cols-2 gap-3">
                            <Button
                                size="lg"
                                variant="outline"
                                className="border-2 border-violet bg-white text-foreground hover:bg-white active:bg-violet/10"
                                disabled={isExiting}
                                onClick={() => currentPair && commitDecision("rejected", currentPair, "tap")}
                            >
                                <XCircle className="mr-2 h-5 w-5" />
                                Reject
                            </Button>
                            <Button
                                size="lg"
                                variant="outline"
                                className="border-2 border-ink bg-white text-foreground hover:bg-white active:bg-ink/10"
                                disabled={isExiting}
                                onClick={() => currentPair && commitDecision("accepted", currentPair, "tap")}
                            >
                                <CheckCircle className="mr-2 h-5 w-5" />
                                Accept
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
