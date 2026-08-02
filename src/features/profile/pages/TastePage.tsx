import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { WordmarkLockup } from "@/design-system/primitives"
import { FirstRunBrandGround, FirstRunPane } from "@/features/profile/components/FirstRunPreview"
import { PickRow } from "@/features/profile/components/PickRow"
import { TASTE_ROWS } from "@/features/profile/constants/tasteVocabularies"
import { useTastePicks } from "@/features/profile/hooks/useTastePicks"
import { useIsMobile } from "@/hooks/use-mobile"

/** Tailwind's `lg`. Below this the screen is a single column, as designed. */
const TWO_PANE_BREAKPOINT = 1024

const FIGURE_STEP_PATH = "/profile/user-details"

/**
 * Canvas 6c — "your taste, in five strokes". First half of first run: five
 * IG-tag rows of photo cards, multi-pick, every row skippable and the whole
 * step skippable. Leads into the figure step (6c2).
 *
 * Picks are session-local — see useTastePicks for why, and note the footer
 * copy deliberately promises nothing about them being remembered.
 */
export function TastePage() {
  const navigate = useNavigate()
  const isCompact = useIsMobile(TWO_PANE_BREAKPOINT)
  const { picks, toggle, total, rowsTouched } = useTastePicks()

  const goToFigure = () => navigate(FIGURE_STEP_PATH)

  return (
    // First run owns the viewport — no bottom nav (see UserDetailsPage).
    // The gutter is 0 until the viewport passes the measure, so 390px is
    // untouched and only tablets and up stop hugging the left edge.
    <div className="flex h-[100dvh] flex-row bg-background pl-[clamp(0px,(100vw_-_720px)*0.25,160px)]">
      {/* The measure. Without a cap this sits in the full-width AppShellLayout,
          so on a desktop the footer CTA stretched the whole 1920px and the pick
          rails ran off toward the horizon. The cap stops short of turning the
          rails into a grid — they are meant to scroll.

          A flat 720px, not a vw clamp. `clamp(390px, 52vw, 720px)` only reaches
          its cap past ~1385px, so every tablet got 52vw — a 426px column at
          820px wide with the rest of the screen empty beside it. Below lg the
          column should just take the width it is given. */}
      <div className="relative flex min-h-0 w-full max-w-[720px] flex-1 flex-col overflow-hidden bg-background">
        {/* One left axis at px-[26px] — the mark, the headline and the footer
            all hang off it. The phone comp centred the mark and the footer copy
            while the form ran left, which reads as a single block at 390px but
            as three competing axes once the measure widens. */}
        <header className="shrink-0 pt-6">
          <WordmarkLockup size="firstRun" className="items-start px-[26px]" />
          <div className="px-[26px] pt-4">
            <p className="text-fluid-sm font-semibold uppercase tracking-[0.22em] text-primary">
              First run · 20 seconds
            </p>
            <h1 className="mb-1 mt-[7px] font-display text-fluid-h1 font-medium leading-[1.08] text-foreground">
              Your taste,
              <br />
              in five strokes.
            </h1>
            <p className="text-fluid-lg leading-[1.5] text-muted-foreground">
              Tap what feels right. Every pick seeds your feed.
            </p>
          </div>
        </header>

        {/* Plain scroller, not Radix ScrollArea — see the note in UserDetailsPage. */}
        <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
          <div className="pb-6 pt-4">
            {TASTE_ROWS.map((row) => (
              <PickRow
                key={row.id}
                label={row.label}
                mode="multi"
                searchable
                tilt
                options={row.options}
                selectedIds={picks[row.id] ?? []}
                onToggle={(optionId) => toggle(row.id, optionId)}
              />
            ))}
          </div>
        </div>

        {/* px-[26px], not the original px-[22px]: the footer copy is on the
            left axis now, so a 4px offset from the headline above it is the
            kind of thing you can't unsee. Only place the mobile rendering
            deliberately departs from the 390px comp. */}
        <footer className="shrink-0 border-t border-hairline bg-background px-[26px] pb-6 pt-3.5">
          <p
            aria-live="polite"
            className="mb-2.5 text-fluid-base font-medium text-muted-foreground"
          >
            {total === 0
              ? "Pick as many as you like, or none — you can wander instead."
              : `${total} picked across ${rowsTouched} ${
                  rowsTouched === 1 ? "row" : "rows"
                } — good taste travels.`}
          </p>
          <Button
            onClick={goToFigure}
            className="h-auto w-full rounded-[3px] py-fluid-btn text-fluid-cta font-bold"
          >
            Next: the figure →
          </Button>
          <button
            type="button"
            onClick={goToFigure}
            className="mt-3 w-full text-left text-fluid-md font-medium text-muted-foreground"
          >
            I'll wander first
          </button>
        </footer>
      </div>

      {/* No figure exists yet at the taste step, so the pane carries the brand
          ground and mounts no renderer at all — the mannequin arrives on the
          next step, which marks the progression. */}
      {!isCompact && (
        <FirstRunPane>
          <FirstRunBrandGround caption="Five strokes, then the figure. Nothing here is permanent — taste is allowed to change its mind." />
        </FirstRunPane>
      )}
    </div>
  )
}

export default TastePage
