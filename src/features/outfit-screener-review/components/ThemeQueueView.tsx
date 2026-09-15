import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, CheckCircle, XCircle } from "lucide-react"

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

/**
 * One theme's review queue. Shows the best-remaining pair as a live
 * composite with two big buttons; accepting or rejecting advances to the
 * next pair immediately — the RPC call and the queue refresh happen in the
 * background so the tap-through loop never waits on the network.
 */
export function ThemeQueueView({ themeId, onBack }: ThemeQueueViewProps) {
    const queryClient = useQueryClient()
    const { data: theme, isLoading: themeLoading } = useCandidateTheme(themeId)
    const { data: pairs, isLoading: pairsLoading, error: pairsError } = usePendingCandidates(themeId)
    const decideMutation = useDecideCandidate(themeId)
    const overrideMutation = useSetPairShoesOverride(themeId)

    // Pairs the reviewer has already decided in this session, removed from the
    // queue on tap rather than waiting for the server round trip.
    const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
    // Guards against a double-tap firing decide_outfit_candidate twice for the
    // same pair before the next render swaps in a new "current" pair.
    const submittedIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        setRemovedIds(new Set())
        submittedIdsRef.current = new Set()
    }, [themeId])

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

    const handleDecide = (decision: CandidateDecision) => {
        if (!currentPair) return
        const candidateId = currentPair.id
        if (submittedIdsRef.current.has(candidateId)) return
        submittedIdsRef.current.add(candidateId)
        setRemovedIds((prev) => new Set(prev).add(candidateId))
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
    }

    const handleOverride = (shoesId: string | null) => {
        if (!currentPair) return
        overrideMutation.mutate({ candidateId: currentPair.id, shoesId })
    }

    return (
        <div className="flex flex-1 flex-col gap-4">
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
                    <div className="mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-lg border border-border bg-muted/10">
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

                    <PairShoeOverride
                        pair={currentPair}
                        footwearOptions={footwearOptions}
                        footwearProducts={footwearProducts ?? []}
                        onOverride={handleOverride}
                    />

                    <div className="grid grid-cols-2 gap-3">
                        <Button size="lg" variant="destructive" onClick={() => handleDecide("rejected")}>
                            <XCircle className="mr-2 h-5 w-5" />
                            Reject
                        </Button>
                        <Button
                            size="lg"
                            className="bg-green-600 text-white hover:bg-green-700"
                            onClick={() => handleDecide("accepted")}
                        >
                            <CheckCircle className="mr-2 h-5 w-5" />
                            Accept
                        </Button>
                    </div>
                </>
            )}
        </div>
    )
}
