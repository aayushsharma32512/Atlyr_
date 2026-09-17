import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { OutfitComposite, ReviewQueueOutfit } from "@/services/admin-inventory/outfitReviewService"
import { useOutfitCategories } from "../hooks/useOutfitCategories"
import { useOutfitsBrowse } from "../hooks/useOutfitsBrowse"
import { OutfitCard } from "./OutfitCard"
import { OutfitDetailSheet } from "./OutfitDetailSheet"
import { OutfitReviewQueue } from "./OutfitReviewQueue"

const SEARCH_DEBOUNCE_MS = 300
// Radix Select items can't take an empty-string value, so "All categories" gets a sentinel.
const ALL_CATEGORIES_VALUE = "all"

/** Active/Hidden outfits grid, with a jump to the swipe queue and an expanded per-outfit sheet. */
export function OutfitsBrowseGrid() {
    const [segment, setSegment] = useState<"active" | "hidden">("active")
    const [inputValue, setInputValue] = useState("")
    const [debouncedQuery, setDebouncedQuery] = useState("")
    const [categoryId, setCategoryId] = useState<string | null>(null)
    const [selectedOutfit, setSelectedOutfit] = useState<ReviewQueueOutfit | null>(null)
    const [showSwipeQueue, setShowSwipeQueue] = useState(false)
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(inputValue.trim()), SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [inputValue])

    const { data: categories } = useOutfitCategories()
    const categoryNames = useMemo(
        () => Object.fromEntries((categories ?? []).map((category) => [category.id, category.name])),
        [categories],
    )

    const visible = segment === "active"
    const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useOutfitsBrowse({
        visible,
        q: debouncedQuery,
        categoryId,
    })

    const rows = useMemo(() => (data?.pages ?? []).flatMap((page) => page.rows), [data])
    const composites = useMemo(() => {
        const map: Record<string, OutfitComposite> = {}
        for (const page of data?.pages ?? []) {
            Object.assign(map, page.composites)
        }
        return map
    }, [data])

    useEffect(() => {
        const node = sentinelRef.current
        if (!node || !hasNextPage) return

        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting && !isFetchingNextPage) {
                fetchNextPage()
            }
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    if (showSwipeQueue) {
        return (
            <div className="flex flex-1 flex-col gap-4">
                <Button variant="ghost" size="sm" className="w-fit" onClick={() => setShowSwipeQueue(false)}>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                </Button>
                <OutfitReviewQueue />
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <Tabs value={segment} onValueChange={(value) => setSegment(value as "active" | "hidden")}>
                <TabsList className="mx-auto">
                    <TabsTrigger value="active">Active</TabsTrigger>
                    <TabsTrigger value="hidden">Hidden</TabsTrigger>
                </TabsList>
            </Tabs>

            {segment === "active" ? (
                <Button variant="outline" size="sm" className="w-fit" onClick={() => setShowSwipeQueue(true)}>
                    Swipe review
                </Button>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    placeholder="Search outfits…"
                    className="sm:flex-1"
                />

                <Select
                    value={categoryId ?? ALL_CATEGORIES_VALUE}
                    onValueChange={(value) => setCategoryId(value === ALL_CATEGORIES_VALUE ? null : value)}
                >
                    <SelectTrigger className="sm:w-44">
                        <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL_CATEGORIES_VALUE}>All categories</SelectItem>
                        {(categories ?? []).map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                                {category.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <LoadingSpinner />
                </div>
            ) : error ? (
                <div className="py-12 text-center text-destructive">Failed to load outfits: {error.message}</div>
            ) : rows.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                    {segment === "active" ? "No active outfits found." : "No hidden outfits found."}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {rows.map((outfit) => (
                            <OutfitCard
                                key={outfit.id}
                                outfit={outfit}
                                composite={composites[outfit.id]}
                                categoryName={categoryNames[outfit.category]}
                                onSelect={() => setSelectedOutfit(outfit)}
                            />
                        ))}
                    </div>

                    <div ref={sentinelRef} className="flex items-center justify-center py-4">
                        {hasNextPage ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={isFetchingNextPage}
                                onClick={() => fetchNextPage()}
                            >
                                {isFetchingNextPage ? "Loading…" : "Load more"}
                            </Button>
                        ) : null}
                    </div>
                </>
            )}

            <OutfitDetailSheet
                outfit={selectedOutfit}
                categoryName={selectedOutfit ? categoryNames[selectedOutfit.category] : undefined}
                visible={visible}
                onClose={() => setSelectedOutfit(null)}
            />
        </div>
    )
}
