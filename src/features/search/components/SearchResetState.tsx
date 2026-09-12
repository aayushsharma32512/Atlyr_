import { useEffect, useMemo, useRef } from "react"

import { Chip, CuratedCollectionRows, OutfitCard, SectionHeader, type CuratedRow } from "@/design-system/primitives"
import { useHomeAllOutfits } from "@/features/home/hooks/useHomeAllOutfits"
import { useSearchBrowseCollections } from "@/features/search/hooks/useSearchBrowseCollections"
import { useSearchFacets } from "@/features/search/hooks/useSearchFacets"
import type { Outfit } from "@/types"
import { resolveOutfitAttribution } from "@/utils/outfitAttribution"

type Gender = "male" | "female"

interface SearchResetStateProps {
  gender: Gender
  heightCm: number
  onSearch: (query: string, mode: "products" | "outfits") => void
  onOpenOutfit: (outfit: Outfit) => void
  isSaved: (outfitId: string) => boolean
  onToggleSave: (outfitId: string, next: boolean) => void
  onLongPressSave: (outfitId: string) => void
}

// Editorial prompts. Hardcoded until a curated source exists — see docs/redesign/SEARCH_SCREEN.md.
const TRENDING_PROMPTS = ["Monsoon layering", "Sangeet, but easy", "Indigo, head to toe"]
const COMMUNITY_PAGE = 20

// House-authored looks carry the house name, not a maker.
const HOUSE_NAMES = new Set(["atlyr", "kalagriha", "कलागृह"])

const firstName = (createdBy?: string | null) => {
  const name = resolveOutfitAttribution(createdBy)
  if (!name || HOUSE_NAMES.has(name.toLowerCase())) return "Atlyr"
  return name.split(/\s+/)[0]
}

const resolveGender = (value: string | null | undefined, fallback: Gender): Gender =>
  value === "male" || value === "female" ? value : fallback

/** Search with nothing typed: chips, trending, curated rows, then the community. */
export function SearchResetState({
  gender,
  heightCm,
  onSearch,
  onOpenOutfit,
  isSaved,
  onToggleSave,
  onLongPressSave,
}: SearchResetStateProps) {
  const facetsQuery = useSearchFacets()
  const browseQuery = useSearchBrowseCollections()
  const communityQuery = useHomeAllOutfits("newly_added", COMMUNITY_PAGE)

  const occasions = useMemo(
    () => facetsQuery.data?.find((group) => group.key === "occasion")?.options ?? [],
    [facetsQuery.data],
  )

  const curatedRows = useMemo<CuratedRow[]>(
    () =>
      (browseQuery.data ?? [])
        .filter((collection) => collection.outfits.length > 0)
        .map((collection) => ({
          id: collection.categoryId,
          label: collection.title,
          looks: collection.outfits.map((entry) => ({
            id: entry.id,
            title: entry.title,
            outfitId: entry.outfit.id,
            renderedItems: entry.studioOutfit?.renderedItems,
            gender: resolveGender(entry.outfit.gender, gender),
            saved: isSaved(entry.outfit.id),
          })),
        })),
    [browseQuery.data, gender, isSaved],
  )
  const outfitById = useMemo(() => {
    const map = new Map<string, Outfit>()
    for (const collection of browseQuery.data ?? []) for (const entry of collection.outfits) map.set(entry.outfit.id, entry.outfit)
    return map
  }, [browseQuery.data])

  const community = useMemo(() => (communityQuery.data?.pages ?? []).flat(), [communityQuery.data?.pages])

  // Load the next community page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = communityQuery
  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-[34px] shrink-0 items-center gap-1.5 overflow-x-auto scrollbar-hide" role="list" aria-label="Occasions">
        {facetsQuery.isLoading
          ? Array.from({ length: 5 }).map((_, i) => <span key={i} className="skeleton-shimmer h-control-chip w-16 shrink-0 rounded-control" />)
          : occasions.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                mark={option.label.toLowerCase() === "handloom"}
                onClick={() => onSearch(option.label, "outfits")}
              />
            ))}
      </div>

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="Trending now" className="border-t border-hairline pt-2" />
        <div className="flex gap-2 overflow-x-auto py-0.5 scrollbar-hide">
          {TRENDING_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSearch(prompt, "outfits")}
              className="flex h-[86px] w-[150px] shrink-0 items-end rounded-lg border border-ink-line bg-ink-deep p-2 text-left"
            >
              <span className="min-w-0 truncate text-card font-semibold text-background">{prompt}</span>
            </button>
          ))}
        </div>
      </section>

      {browseQuery.isLoading ? (
        <section className="flex flex-col gap-2.5">
          <div className="border-t border-hairline pt-2">
            <span className="skeleton-shimmer block h-3 w-24 rounded-control" />
          </div>
          <div className="flex gap-2 overflow-hidden py-0.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <span key={i} className="skeleton-shimmer h-[210px] w-[150px] shrink-0 rounded-lg" />
            ))}
          </div>
        </section>
      ) : (
        <CuratedCollectionRows
          rows={curatedRows}
          heightCm={heightCm}
          onLookSelect={(look) => {
            const outfit = look.outfitId ? outfitById.get(look.outfitId) : undefined
            if (outfit) onOpenOutfit(outfit)
          }}
          onToggleSave={(look, next) => look.outfitId && onToggleSave(look.outfitId, next)}
          onLongPressSave={(look) => look.outfitId && onLongPressSave(look.outfitId)}
        />
      )}

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="From the community" className="border-t border-hairline pt-2" />
        {communityQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="skeleton-shimmer h-[250px] rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {community.map((entry, index) => {
              const saved = isSaved(entry.outfit.id)
              return (
                <div key={entry.id} className="h-[250px]">
                  <OutfitCard
                    title={entry.title}
                    by={firstName(entry.outfit.created_by)}
                    outfitId={entry.outfit.id}
                    renderedItems={entry.renderedItems}
                    gender={resolveGender(entry.outfit.gender, gender)}
                    heightCm={heightCm}
                    saved={saved}
                    tiltIndex={index}
                    onSelect={() => onOpenOutfit(entry.outfit)}
                    onToggleSave={() => onToggleSave(entry.outfit.id, !saved)}
                    onLongPressSave={() => onLongPressSave(entry.outfit.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
        <div ref={sentinelRef} className="h-2" />
        {isFetchingNextPage ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <span key={i} className="skeleton-shimmer h-[250px] rounded-lg" />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}
