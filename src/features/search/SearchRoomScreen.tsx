import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { cn } from "@/lib/utils"
import { useSearchFacets, type FacetGroup, type FacetKey } from "@/features/search/hooks/useSearchFacets"

type GarmentBox = { fx: number; fy: number; fw: number; fh: number; ar: number }

/**
 * Renders a product cutout scaled so its garment (the opaque pixels) always fills
 * the same fraction of the tile — regardless of how much transparent whitespace the
 * source photo carries. Nothing is cropped: only the transparent margin is clipped,
 * so every garment reads at a consistent size and stays whole. Falls back to a plain
 * contained image until the bounding box is measured (or if measurement is blocked).
 */
function TrimmedGarment({ src }: { src?: string | null }) {
  const [box, setBox] = useState<GarmentBox | null>(null)

  useEffect(() => {
    setBox(null)
    if (!src || typeof document === "undefined") return
    let cancelled = false
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      if (cancelled) return
      try {
        const S = 160
        const canvas = document.createElement("canvas")
        canvas.width = S
        canvas.height = S
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, S, S)
        const { data } = ctx.getImageData(0, 0, S, S)
        let minX = S, minY = S, maxX = 0, maxY = 0, found = false
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            if (data[(y * S + x) * 4 + 3] > 16) {
              found = true
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
            }
          }
        }
        if (!found) return
        setBox({
          fx: minX / S,
          fy: minY / S,
          fw: (maxX - minX + 1) / S,
          fh: (maxY - minY + 1) / S,
          ar: img.naturalHeight / img.naturalWidth,
        })
      } catch {
        // Tainted canvas / read blocked — keep the contained fallback.
      }
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])

  if (!src) return null
  if (!box) {
    return <img src={src} alt="" crossOrigin="anonymous" loading="lazy" className="max-h-full max-w-full object-contain" />
  }
  const target = 0.82 // garment fills this fraction of the tile's shorter side
  const bboxW = box.fw
  const bboxH = box.fh * box.ar
  const widthPct = (target / Math.max(bboxW, bboxH)) * 100
  const left = 50 - widthPct * (box.fx + box.fw / 2)
  const top = 50 - widthPct * box.ar * (box.fy + box.fh / 2)
  return (
    <img
      src={src}
      alt=""
      crossOrigin="anonymous"
      style={{ position: "absolute", width: `${widthPct}%`, height: "auto", left: `${left}%`, top: `${top}%`, maxWidth: "none" }}
    />
  )
}

type Selection = Record<FacetKey, string[]>

const EMPTY_SELECTION: Selection = { occasion: [], vibe: [], fit: [], feel: [] }

// Which URL filter param each facet group maps onto for the results screen.
const FACET_PARAM: Record<FacetKey, string> = {
  occasion: "occasions",
  vibe: "vibes",
  fit: "fits",
  feel: "feels",
}

/**
 * 6g — the search room. A charcoal entry surface for the /search page (shown while
 * no search is active): an editorial prompt, one search line, and faceted rows
 * (occasion · vibe · fit · feel) pulled live from the catalog. Selecting facets and
 * hitting "Show pieces" navigates /search into results mode. Same responsive frame
 * + tokens as Home; a dark room in a light app. Rendered inside SearchScreen, which
 * already sits in the app shell — so no layout wrapper here.
 */
export function SearchRoom() {
  const navigate = useNavigate()
  const facetsQuery = useSearchFacets()
  const [query, setQuery] = useState("")
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)

  const totalFilters = useMemo(
    () => Object.values(selection).reduce((sum, values) => sum + values.length, 0),
    [selection],
  )

  const toggle = (key: FacetKey, value: string) => {
    setSelection((prev) => {
      const current = prev[key]
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      return { ...prev, [key]: next }
    })
  }

  const goToResults = () => {
    const params = new URLSearchParams()
    const trimmed = query.trim()
    // Facet-only search: the semantic backend needs a query to rank on, so when
    // nothing is typed, seed it from the chosen facet values (their words). The
    // facets also refine the results (SearchScreen reads them from the URL). Without
    // this, "Show pieces" would navigate but SearchScreen would stay on the room.
    const derived =
      trimmed ||
      [...selection.vibe, ...selection.fit, ...selection.feel, ...selection.occasion]
        .map((v) => v.replace(/[-_]/g, " "))
        .join(" ")
        .trim()
    if (derived) params.set("search", derived)
    params.set("mode", "products")
    for (const key of Object.keys(selection) as FacetKey[]) {
      if (selection[key].length) params.set(FACET_PARAM[key], selection[key].join(","))
    }
    navigate(`/search?${params.toString()}`)
  }

  const groups = facetsQuery.data ?? []

  return (
    <div className="warp-weft-dark relative flex flex-1 flex-col overflow-y-auto bg-ink-deep scrollbar-hide">
        <div className="mx-auto w-full max-w-[24.5rem] flex-1 px-5 pb-44 pt-8 md:max-w-[47rem] lg:max-w-[62rem] xl:max-w-[78rem]">
          {/* Editorial prompt */}
          <h1 className="font-sans text-[26px] font-semibold leading-tight text-background">
            What are you
            <br />
            <span className="font-display text-[30px] font-medium italic text-terracotta-tint">looking for?</span>
          </h1>

          {/* One search line — a raised box so it reads clearly on the charcoal ground. */}
          <div className="mt-6 flex items-center gap-3 rounded-[4px] border border-white/15 bg-white/[0.06] px-4 py-3">
            <span aria-hidden className="text-lg text-terracotta">◉</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") goToResults()
              }}
              placeholder="try “ikat overshirt for a gallery night”"
              className="w-full bg-transparent text-[14px] text-background placeholder:text-on-ink-1 focus:outline-none"
            />
          </div>

          {/* Facet rows */}
          <div className="mt-8 flex flex-col gap-7">
            {facetsQuery.isLoading
              ? Array.from({ length: 4 }).map((_, i) => <FacetRowSkeleton key={i} />)
              : groups.map((group) => (
                  <FacetRow
                    key={group.key}
                    group={group}
                    selected={selection[group.key]}
                    onToggle={(value) => toggle(group.key, value)}
                  />
                ))}
            {facetsQuery.isError ? (
              <p className="text-[13px] text-on-ink-1">Couldn’t load search options right now.</p>
            ) : null}
          </div>

          <p className="mt-10 text-center text-[10px] text-on-ink-2">
            Type, tap, or snap — text, image and filters fuse into one ranking.
          </p>
        </div>

        {/* Show pieces bar — gradient backdrop fades the cards out beneath it so it
            reads as a bar, not something overlapping the grid. */}
        <div className="pointer-events-none fixed inset-x-0 bottom-[3.75rem] z-20 bg-gradient-to-t from-ink-deep via-ink-deep/95 to-transparent pb-3 pt-10">
          <div className="pointer-events-auto mx-auto w-full max-w-[24.5rem] px-5 md:max-w-[34rem]">
            <button
              type="button"
              onClick={goToResults}
              className="flex w-full items-center justify-center gap-3 rounded-[3px] bg-primary py-3.5 text-[14px] font-bold text-primary-foreground shadow-[0_8px_22px_rgba(23,20,16,0.4)] transition-opacity hover:bg-primary/90"
            >
              {totalFilters > 0 ? "Show pieces" : "Explore the catalogue"} →
              {totalFilters > 0 ? (
                <span className="rounded-badge border border-gold px-2 py-0.5 text-[10px] font-semibold text-gold">
                  {totalFilters} {totalFilters === 1 ? "filter" : "filters"}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </div>
  )
}

// Fixed per-slot tilts — pinned-scrap / clipboard look, same as the boards & feed.
const FACET_TILT = ["-2deg", "1.5deg", "-1deg", "2deg", "-1.5deg", "1deg"]

function FacetRow({
  group,
  selected,
  onToggle,
}: {
  group: FacetGroup
  selected: string[]
  onToggle: (value: string) => void
}) {
  // Per-row mini-search — filters this facet's vocabulary. Empty → the top 4;
  // typing reveals matches from the rest of the fetched options.
  const [filter, setFilter] = useState("")
  const term = filter.trim().toLowerCase()
  const shown = term
    ? group.options.filter((o) => o.label.toLowerCase().includes(term) || o.value.toLowerCase().includes(term)).slice(0, 8)
    : group.options.slice(0, 4)

  if (!group.options.length) return null
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-3">
        <span className="text-[14px] font-semibold uppercase tracking-[0.16em] text-on-ink-1">{group.label}</span>
        {/* medium-visible search chip (the top bar is the loud one) */}
        <label className="flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1">
          <span aria-hidden className="text-[11px] text-terracotta">⌕</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={group.hint}
            className="w-24 bg-transparent text-[10px] text-background placeholder:text-on-ink-1 focus:outline-none"
          />
        </label>
      </div>
      {/* Capped to 4 big cards per row (more while searching); grid fills the width
          on laptop. py leaves room for the tilted corners so they don't clip. */}
      <div className="grid grid-cols-2 gap-4 px-1 py-2 sm:grid-cols-4">
        {shown.map((option, index) => {
          const isActive = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              style={{ transform: `rotate(${FACET_TILT[index % FACET_TILT.length]})` }}
              className={cn(
                "relative w-full overflow-hidden rounded-lg border bg-card text-left shadow-[0_4px_12px_rgba(23,20,16,0.35)] transition-colors",
                isActive ? "border-terracotta ring-1 ring-terracotta/40" : "border-hairline hover:border-hairline-3",
              )}
            >
              {/* Garment sits contained on a cream warp/weft ground — not cropped/overflowing. */}
              {/* TrimmedGarment normalises each cutout to a consistent size by its
                  opaque bounding box — whole garments, no cropping. */}
              <div className="warp-weft relative flex aspect-square items-center justify-center overflow-hidden bg-secondary p-3">
                <TrimmedGarment src={option.imageUrl} />
              </div>
              <span className="block truncate bg-card px-2.5 py-2 text-[12px] font-semibold text-foreground">
                {option.label}
              </span>
              {isActive ? (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-terracotta text-[9px] font-bold text-background">
                  ✓
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {term && shown.length === 0 ? (
        <p className="px-1 text-[11px] text-on-ink-2">No {group.label.toLowerCase()} matches “{filter.trim()}”.</p>
      ) : null}
    </section>
  )
}

function FacetRowSkeleton() {
  return (
    <section>
      <div className="mb-2.5 h-3 w-24 animate-pulse rounded bg-ink-line" />
      <div className="grid grid-cols-2 gap-4 px-1 py-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-[5/6] w-full animate-pulse rounded-lg bg-ink-line/60" />
        ))}
      </div>
    </section>
  )
}

export default SearchRoom
