import { cn } from "@/lib/utils"

/**
 * कलागृह — the house wordmark.
 *
 * Locked decisions (Kalagriha handoff §2.3):
 *  · In-app the wordmark is **Devanagari only**. The Latin "KALAGRIHA" survives
 *    solely as the letterspaced whisper caption on the landing lockup — never
 *    in a screen header.
 *  · The lockup thread renders **taupe** in-app. The canvas art for 6c/6c2 draws
 *    that rule in gold, but that art predates the rebrand; the handoff's gold law
 *    is later and stricter — gold is provenance only (Nama, seals, ✦ YOURS), so a
 *    decorative gold rule under a wordmark is exactly the usage it forbids.
 *  · App copy is English. Devanagari lives in branding only, never on a control.
 */
export type WordmarkSize = "header" | "firstRun" | "landing" | "micro"

export interface WordmarkLockupProps {
  /**
   * `header` — inline screen header mark.
   * `firstRun` — centred mark over a short thread, used by onboarding (6c/6c2).
   * `landing` — full lockup: mark, thread, Latin whisper.
   * `micro` — smallest mark, for dense chrome.
   */
  size?: WordmarkSize
  /** Render for a charcoal surface (auth, search room, reveal). */
  onDark?: boolean
  className?: string
}

const MARK = "कलागृह"

const MARK_SIZE: Record<WordmarkSize, string> = {
  micro: "text-[13px]",
  header: "text-[17px]",
  firstRun: "text-[27px]",
  landing: "text-[40px]",
}

export function WordmarkLockup({
  size = "header",
  onDark = false,
  className,
}: WordmarkLockupProps) {
  const showThread = size === "firstRun" || size === "landing"
  const showWhisper = size === "landing"

  return (
    <div
      className={cn(
        "flex flex-col items-center",
        size === "header" && "flex-row",
        className,
      )}
    >
      {/* aria-label carries the Latin name so screen readers and search don't
          only ever see the Devanagari glyphs. */}
      <span
        aria-label="Kalagriha"
        className={cn(
          "font-deva font-medium leading-none tracking-[0.04em]",
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
            size === "landing"
              ? "w-[230px] bg-[linear-gradient(90deg,transparent,hsl(var(--taupe)),transparent)]"
              : "w-[34px] bg-taupe",
          )}
        />
      )}

      {showWhisper && (
        <span
          aria-hidden="true"
          className={cn(
            "mt-[10px] text-[9px] uppercase tracking-[0.4em]",
            onDark ? "text-on-ink-1" : "text-muted-foreground",
          )}
        >
          Kalagriha
        </span>
      )}
    </div>
  )
}
