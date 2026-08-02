import { useMemo, useState, type CSSProperties } from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The IG-tag row: a label, a hairline, and a horizontally scrolling rail of
 * tiles. Canvas 6c (taste, multi-pick) and 6c2 (figure, single-pick) are the
 * same grammar with different knobs, so both are this component.
 *
 * Rules carried over from the canvas + handoff §6.1:
 *  · Open vocabularies carry the ⌕ mini-search; closed sets show "pick one" /
 *    "optional" instead.
 *  · Tilt is the *selection* signal on taste tiles — unselected tiles sit flat,
 *    and figure tiles never tilt at all.
 *  · Placeholder tiles stay honest and labelled (PHOTO / FIGURE) until art lands.
 *  · Every row is skippable. Nothing here blocks.
 */

export interface PickTile {
  id: string
  label: string
  /**
   * Accessible name, when the visible label is deliberately terse — the skin
   * swatches show "01"…"07" per the handoff (numbered, never named) but still
   * need to announce something meaningful.
   */
  description?: string
  /** Secondary line, e.g. the cm range under a height band. */
  sublabel?: string
  imageUrl?: string
  /**
   * Show only a region of `imageUrl`, in source pixels. Needed for art that
   * lives in a large composition space — the baked hair cutouts are full
   * 1800×3072 mannequin canvases with the hair in a small patch near the top,
   * so uncropped they render as a speck.
   */
  imageCrop?: { x: number; y: number; w: number; naturalWidth: number }
  /** Flat colour fill — the skin-tone swatches. */
  color?: string
  /** Honest stand-in until real art exists. Renders a woven tile with a caption. */
  placeholder?: "PHOTO" | "FIGURE"
  /** Dashed outline — the "not sure" escape hatch on an otherwise closed set. */
  dashed?: boolean
}

export interface PickRowProps {
  label: string
  options: PickTile[]
  selectedIds: string[]
  onToggle: (id: string) => void
  mode?: "single" | "multi"
  variant?: "photo" | "swatch" | "pill"
  /** Show the ⌕ mini-search. Use for vocabularies that will grow. */
  searchable?: boolean
  /** Right-aligned hint for closed sets: "pick one", "optional". */
  hint?: string
  /** Selected tiles tilt. Taste rows only — never the figure rows. */
  tilt?: boolean
  className?: string
}

/**
 * Tile widths. These are CSS variables rather than literals because the crop
 * maths below has to agree with them, and the two used to be kept in sync by
 * hand — a `PHOTO_FACE_WIDTH = 76` constant mirroring `w-[84px]` less its p-1.
 * That only held while the width was fixed; the moment it scales, a JS constant
 * is a stale copy and every cropped tile mis-frames. So the width lives in CSS,
 * and TileFace expresses the crop as a ratio of it.
 *
 * `--face-w` subtracts the tile's p-1 on both sides. The padding stays literal
 * on purpose: scaling it too would put the term back in two places.
 */
const TILE_WIDTHS: Record<NonNullable<PickRowProps["variant"]>, string> = {
  photo: "clamp(84px, 6vw, 112px)",
  swatch: "clamp(60px, 4.3vw, 80px)",
  pill: "auto",
}

/** Native proportions of a photo face, from the 76×58 the canvas specified. */
const PHOTO_FACE_ASPECT = "aspect-[76/58]"

/**
 * Deterministic angle in roughly ±1.1° from the tile id, so a selected tile
 * keeps the same tilt across re-renders instead of jittering. The canvas draws
 * each selected card at its own slight angle rather than one angle per row.
 */
function tiltFor(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return (((Math.abs(hash) % 23) - 11) / 10) * 1.0
}

export function PickRow({
  label,
  options,
  selectedIds,
  onToggle,
  mode = "single",
  variant = "photo",
  searchable = false,
  hint,
  tilt = false,
  className,
}: PickRowProps) {
  const [query, setQuery] = useState("")

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) => option.label.toLowerCase().includes(q))
  }, [options, query])

  const isSelected = (id: string) => selectedIds.includes(id)

  return (
    <section className={cn("px-6 pb-[13px]", className)}>
      <div className="flex items-center gap-2.5">
        <span className="text-fluid-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </span>

        {searchable ? (
          <label className="flex flex-1 items-center gap-1 border-b border-hairline px-0.5 py-[3px]">
            <Search className="size-2.5 shrink-0 text-taupe" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`search ${label.toLowerCase()}`}
              aria-label={`Search ${label.toLowerCase()}`}
              className="w-full bg-transparent text-fluid-xs2 text-ink-body placeholder:text-taupe focus:outline-none"
            />
          </label>
        ) : (
          <>
            <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
            {hint && (
              <span className="text-fluid-xs font-medium text-taupe">{hint}</span>
            )}
          </>
        )}
      </div>

      <div
        role={mode === "single" ? "radiogroup" : "group"}
        aria-label={label}
        style={
          {
            "--tile-w": TILE_WIDTHS[variant],
            "--face-w": `calc(${TILE_WIDTHS[variant]} - 0.5rem)`,
          } as CSSProperties
        }
        className={cn(
          // min-w-0 matters: without it this grows to fit its tiles and drags
          // the whole page wider than the viewport instead of scrolling.
          "mt-2 flex w-full min-w-0 overflow-x-auto scrollbar-hide",
          // Room above the rail for the ✓ badge, which overhangs the tile.
          "pt-1.5",
          // Bleed past the section's right padding to the screen edge, so an
          // overflowing rail leaves a tile half-visible. That peek is the only
          // affordance that the row scrolls — the scrollbar is hidden.
          "-mr-6 pr-6",
          variant === "pill" ? "gap-1.5" : "gap-2",
        )}
      >
        {visible.map((option) => {
          const selected = isSelected(option.id)
          const angle = tilt && selected ? tiltFor(option.id) : 0

          return (
            <button
              key={option.id}
              type="button"
              role={mode === "single" ? "radio" : undefined}
              aria-label={option.description}
              aria-checked={mode === "single" ? selected : undefined}
              aria-pressed={mode === "multi" ? selected : undefined}
              onClick={() => onToggle(option.id)}
              style={angle ? { transform: `rotate(${angle}deg)` } : undefined}
              className={cn(
                "relative shrink-0 rounded-[5px] border bg-card text-left transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                variant === "photo" && "w-[var(--tile-w)] p-1",
                variant === "swatch" && "w-[var(--tile-w)] p-1",
                variant === "pill" &&
                  (option.sublabel ? "px-2.5 py-[7px]" : "px-3 py-2"),
                option.dashed
                  ? "border-dashed border-hairline-4"
                  : "border-hairline",
                selected &&
                  (variant === "pill"
                    ? "border-[1.5px] border-foreground bg-foreground"
                    : "border-[1.5px] border-foreground shadow-[0_2px_8px_hsl(var(--ink)/0.18)]"),
              )}
            >
              {selected && variant !== "pill" && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-[5px] z-[2] flex size-4 items-center justify-center rounded-full bg-foreground text-[9px] font-bold leading-none text-background"
                >
                  ✓
                </span>
              )}

              {variant === "pill" ? (
                <>
                  <span
                    className={cn(
                      "block text-fluid-xs2 font-semibold",
                      selected ? "text-background" : "text-ink-body",
                    )}
                  >
                    {option.label}
                  </span>
                  {option.sublabel && (
                    <span
                      className={cn(
                        // 7px is below the ramp's floor — the height-band cm
                        // ranges are the only thing this small.
                        "block text-[clamp(0.438rem,0.24vw+0.379rem,0.625rem)]",
                        selected ? "text-on-ink-1" : "text-taupe",
                      )}
                    >
                      {option.sublabel}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <TileFace option={option} variant={variant} />
                  <span
                    className={cn(
                      "block px-0 pb-0.5 pt-1 text-center",
                      variant === "swatch" ? "text-fluid-xs" : "text-fluid-sm",
                      selected
                        ? "font-semibold text-foreground"
                        : "font-medium text-ink-body",
                    )}
                  >
                    {option.label}
                  </span>
                </>
              )}
            </button>
          )
        })}

        {visible.length === 0 && (
          <p className="py-4 text-fluid-xs2 text-taupe">
            Nothing matching “{query.trim()}” yet.
          </p>
        )}
      </div>
    </section>
  )
}

function TileFace({
  option,
  variant,
}: {
  option: PickTile
  variant: "photo" | "swatch"
}) {
  // A missing image falls through to the honest placeholder rather than leaving
  // a broken-image glyph — tile art is still being produced, so 404s are
  // expected rather than exceptional.
  const [imageBroken, setImageBroken] = useState(false)

  if (variant === "swatch") {
    return (
      <span
        className="block aspect-[52/44] rounded-[3px]"
        style={{ backgroundColor: option.color }}
        aria-hidden="true"
      />
    )
  }

  if (option.imageUrl && !imageBroken) {
    const { imageCrop: crop } = option

    if (crop) {
      // Scale the source so the crop's width fills the face, then offset it so
      // the crop's origin lands at the face's top-left. Percentages can't do
      // this: `top` would resolve against the face's height, not its width, and
      // the two axes must share one scale factor.
      //
      // That factor is the face width over the crop width, and every value below
      // is therefore `face width × some ratio of the source`. The ratios are
      // pure numbers — viewport-independent — so they can be handed to calc()
      // and multiplied by --face-w at paint time. That is what lets the tile
      // scale without JS ever needing to know how wide it currently is.
      return (
        <span
          className={cn(
            "relative block overflow-hidden rounded-[3px] bg-background",
            PHOTO_FACE_ASPECT,
          )}
        >
          <img
            src={option.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageBroken(true)}
            className="absolute max-w-none"
            style={{
              width: `calc(var(--face-w) * ${crop.naturalWidth / crop.w})`,
              left: `calc(var(--face-w) * ${-crop.x / crop.w})`,
              top: `calc(var(--face-w) * ${-crop.y / crop.w})`,
            }}
          />
        </span>
      )
    }

    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-[3px] bg-background",
          PHOTO_FACE_ASPECT,
        )}
      >
        <img
          src={option.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setImageBroken(true)}
          // 86% ≈ the old max-h-[50px] against a 58px face, held as a ratio so
          // the inset survives the face growing.
          className="max-h-[86%] max-w-[88%] object-contain"
        />
      </span>
    )
  }

  // No art yet. Say so rather than shipping an empty box.
  return (
    <span
      className={cn(
        "bg-placeholder-grid flex items-end justify-center rounded-[3px] bg-background pb-1",
        PHOTO_FACE_ASPECT,
      )}
    >
      <span className="text-fluid-2xs font-semibold tracking-[0.1em] text-taupe">
        {option.placeholder ?? "PHOTO"}
      </span>
    </span>
  )
}
