import { Link } from "react-router-dom"

/**
 * /admin — the index the admin routes never had.
 *
 * Before this, `/admin` fell through to the catch-all and rendered NotFound, and
 * the six dashboards had exactly one cross-link between them, so every path had
 * to be typed from memory.
 *
 * Rendered in the ops (pre-Kalagriha stone) register, because `/admin` resolves
 * to "ops" in useSurfaceTheme — matching the dashboards it sits above. The
 * design-preview links below deliberately jump to the app register instead:
 * `/admin/design-system/*` is exempted there, otherwise they'd preview the new
 * design in the old palette.
 */

type Entry = {
  label: string
  to: string
  blurb: string
  /** Canvas id, where the row corresponds to a screen in the design doc. */
  ref?: string
  external?: boolean
}

type Group = {
  title: string
  note?: string
  entries: Entry[]
}

const GROUPS: Group[] = [
  {
    title: "Design previews",
    note: "The Kalagriha screens. These render in the app palette, not this one.",
    entries: [
      {
        ref: "6a",
        label: "Landing gate",
        to: "/",
        blurb: "Live. Wordmark, tagline, one terracotta; marketing scrolls below.",
      },
      {
        ref: "6b",
        label: "Sign in",
        to: "/auth/login",
        blurb: "Live. The charcoal room — Google only.",
      },
      {
        ref: "6c",
        label: "Taste pick",
        to: "/admin/design-system/taste",
        blurb: "Five rows, multi-pick. Built but skipped from the first-run flow.",
      },
      {
        ref: "6c2",
        label: "Figure setup",
        to: "/admin/design-system/figure",
        blurb: "First-run chrome forced, so an onboarded account still sees it.",
      },
    ],
  },
  {
    title: "Live screens",
    note: "The real thing, with your own session and data.",
    entries: [
      { label: "Home", to: "/home", blurb: "For-you feed, pins, recent styles." },
      { label: "Search", to: "/search", blurb: "Text + image dual retrieval." },
      { label: "Collections", to: "/collection", blurb: "Moodboards, saves, creations." },
      { label: "Studio", to: "/studio", blurb: "The core loop — slots, tray, remix." },
      { label: "Profile", to: "/profile", blurb: "Likeness, try-ons, settings." },
      {
        label: "Figure setup",
        to: "/profile/user-details",
        blurb: "The live route — edit chrome once onboarding_complete is set.",
      },
    ],
  },
  {
    title: "Tools",
    entries: [
      { label: "Invites", to: "/admin/invites", blurb: "Issue and track waitlist invites." },
      { label: "Enrichment", to: "/admin/enrichment", blurb: "Review enriched product data." },
      { label: "Ingestion v2", to: "/admin/ingestion-v2", blurb: "The v2 ingestion dashboard." },
      {
        label: "Ingestion automated",
        to: "/admin/ingestion-automated",
        blurb: "Automated scrape → identify → segment → place.",
      },
      { label: "Placement", to: "/admin/placement", blurb: "Garment placement on the mannequin." },
      { label: "Studio admin", to: "/admin/studio", blurb: "Admin-side studio tooling." },
      { label: "HITL", to: "/hitl", blurb: "Inventory dashboard. Note: currently unguarded." },
      { label: "Mannequin", to: "/mannequin", blurb: "Mannequin rendering harness." },
    ],
  },
]

export default function AdminHome() {
  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything in one place, so no route has to be typed from memory.
          </p>
        </header>

        <div className="space-y-8">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h2>
              {group.note && (
                <p className="mt-1 text-xs text-muted-foreground/80">{group.note}</p>
              )}

              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {group.entries.map((entry) => (
                  <li key={entry.to + entry.label}>
                    <Link
                      to={entry.to}
                      className="flex items-baseline gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      {entry.ref && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                          {entry.ref}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {entry.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {entry.blurb}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {entry.to}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
