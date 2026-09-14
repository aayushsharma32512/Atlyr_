import { cn } from "@/lib/utils"

/**
 * Atlyr — the house wordmark.
 *
 * Locked decisions (brand handoff §2.3):
 *  · The mark is the Latin wordmark, set in the display serif like every
 *    title. It appears once: the letterspaced caption that used to repeat it
 *    under the thread was the Devanagari-era pairing and read as the name twice.
 *  · The lockup thread renders **taupe** in-app. The canvas art for 6c/6c2 draws
 *    that rule in gold, but that art predates the rebrand; the handoff's gold law
 *    is later and stricter — gold is provenance only (Nama, seals, ✦ YOURS), so a
 *    decorative gold rule under a wordmark is exactly the usage it forbids.
 *  · App copy is English. The wordmark lives in branding only, never on a control.
 */
export type WordmarkSize = "header" | "firstRun" | "landing" | "micro"

export interface WordmarkLockupProps {
  /**
   * `header` — inline screen header mark.
   * `firstRun` — centred mark over a short thread, used by onboarding (6c/6c2).
   * `landing` — full lockup: mark over the long thread.
   * `micro` — smallest mark, for dense chrome.
   */
  size?: WordmarkSize
  /** Render for a charcoal surface (auth, search room, reveal). */
  onDark?: boolean
  className?: string
}

const MARK = "Atlyr"

/**
 * `micro` and `header` stay literal: both sit inside fixed chrome (the landing
 * header is an h-16 bar), so growing them would push against a height that
 * doesn't grow with them. The two brand sizes are the ones that own their
 * space, and those scale.
 */
const MARK_SIZE: Record<WordmarkSize, string> = {
  micro: "text-[13px]",
  header: "text-[17px]",
  firstRun: "text-fluid-mark-firstrun",
  landing: "text-fluid-mark-landing",
}

export function WordmarkLockup({
  size = "header",
  onDark = false,
  className,
}: WordmarkLockupProps) {
  const showThread = size === "firstRun" || size === "landing"

  return (
    <div
      className={cn(
        "flex flex-col items-center",
        size === "header" && "flex-row",
        className,
      )}
    >
      <span
        className={cn(
          "font-display font-medium leading-none",
          MARK_SIZE[size],
          onDark ? "text-background" : "text-foreground",
        )}
      >
        {MARK}
      </span>

      {showThread && (
        <span
          aria-hidden="true"
          className={cn(
            "mt-[11px] h-px",
            // The thread reads as a measure under the mark, so it has to track
            // the mark's growth — held at 230px it would look like a dash under
            // a 72px wordmark.
            size === "landing"
              ? "w-[clamp(230px,26vw,330px)] bg-[linear-gradient(90deg,transparent,hsl(var(--taupe)),transparent)]"
              : "w-[34px] bg-taupe",
          )}
        />
      )}

    </div>
  )
}
