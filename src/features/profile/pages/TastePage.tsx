import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { WordmarkLockup } from "@/design-system/primitives"
import { PickRow } from "@/features/profile/components/PickRow"
import { TASTE_ROWS } from "@/features/profile/constants/tasteVocabularies"
import { useTastePicks } from "@/features/profile/hooks/useTastePicks"

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
  const { picks, toggle, total, rowsTouched } = useTastePicks()

  const goToFigure = () => navigate(FIGURE_STEP_PATH)

  return (
    // First run owns the viewport — no bottom nav (see UserDetailsPage).
    <div className="flex h-[100dvh] flex-col bg-background">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="shrink-0 pt-6">
          <WordmarkLockup size="firstRun" />
          <div className="px-[26px] pt-4">
            <p className="text-[8.5px] font-semibold uppercase tracking-[0.22em] text-primary">
              First run · 20 seconds
            </p>
            <h1 className="mb-1 mt-[7px] font-display text-[26px] font-medium leading-[1.08] text-foreground">
              Your taste,
              <br />
              in five strokes.
            </h1>
            <p className="text-[11.5px] leading-[1.5] text-muted-foreground">
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

        <footer className="shrink-0 border-t border-hairline bg-background px-[22px] pb-6 pt-3.5">
          <p
            aria-live="polite"
            className="mb-2.5 text-center text-[9.5px] font-medium text-muted-foreground"
          >
            {total === 0
              ? "Pick as many as you like, or none — you can wander instead."
              : `${total} picked across ${rowsTouched} ${
                  rowsTouched === 1 ? "row" : "rows"
                } — good taste travels.`}
          </p>
          <Button
            onClick={goToFigure}
            className="h-auto w-full rounded-[3px] py-[15px] text-[13px] font-bold"
          >
            Next: the figure →
          </Button>
          <button
            type="button"
            onClick={goToFigure}
            className="mt-3 w-full text-center text-[11px] font-medium text-muted-foreground"
          >
            I'll wander first
          </button>
        </footer>
      </div>
    </div>
  )
}

export default TastePage
