import { useEffect, useMemo, useRef, useState } from "react"

import { Icons } from "@/design-system/icons"
import { BottomSheet, Chip, type FilterCategory } from "@/design-system/primitives"
import { cn } from "@/lib/utils"

interface SearchFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: FilterCategory[]
  activeFilters: string[]
  onApply: (filterIds: string[]) => void
  onClear: () => void
  /** Fires on every toggle so type-dependent options can refetch. */
  onDraftChange?: (filterIds: string[]) => void
}

const TOP_MATCHES = 5

// Placeholder rows the options hook emits when a group is empty.
const isPlaceholder = (id: string) => id.endsWith(":none")

/** The filter sheet: active chips, one open group at a time, Clear + Apply. */
export function SearchFilterSheet({
  open,
  onOpenChange,
  categories,
  activeFilters,
  onApply,
  onClear,
  onDraftChange,
}: SearchFilterSheetProps) {
  const [draft, setDraft] = useState<string[]>(activeFilters)
  const [expanded, setExpanded] = useState<string | null>(categories[0]?.id ?? null)
  const [search, setSearch] = useState<Record<string, string>>({})

  // Draft resets only when the sheet opens, not while it is being edited.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(activeFilters)
      setSearch({})
      const firstActive = categories.find((c) => activeFilters.some((id) => id.startsWith(`${c.id}:`)))
      setExpanded(firstActive?.id ?? categories[0]?.id ?? null)
    }
    wasOpen.current = open
  }, [open, activeFilters, categories])

  // Options can change under the draft (type drives the rest). Drop what no longer exists.
  useEffect(() => {
    if (!open) return
    setDraft((prev) => {
      const next = prev.filter((id) => {
        const [group] = id.split(":")
        if (group === "type" || group === "collection") return true
        const category = categories.find((c) => c.id === group)
        return !category || category.options.some((o) => o.id === id)
      })
      return next.length === prev.length ? prev : next
    })
  }, [categories, open])

  const labelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of categories) for (const o of c.options) map.set(o.id, o.label)
    return map
  }, [categories])

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      onDraftChange?.(next)
      return next
    })
  }

  const handleApply = () => {
    onApply(draft)
    onOpenChange(false)
  }
  const handleClear = () => {
    setDraft([])
    onDraftChange?.([])
    onClear()
    onOpenChange(false)
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Filters">
      {draft.length > 0 ? (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 py-3 scrollbar-hide">
          {draft.map((id) => (
            <Chip
              key={id}
              label={labelById.get(id) ?? id.split(":")[1] ?? id}
              mark={(labelById.get(id) ?? "").toLowerCase() === "handloom"}
              active
              onRemove={() => toggle(id)}
            />
          ))}
        </div>
      ) : (
        <div className="h-3 shrink-0" />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {categories.map((category, index) => {
          const isOpen = expanded === category.id
          const term = (search[category.id] ?? "").trim().toLowerCase()
          const options = category.options.filter((o) => !isPlaceholder(o.id))
          const shown = term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options
          return (
            <div
              key={category.id}
              className={cn("border-t border-hairline", index === categories.length - 1 && "border-b")}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : category.id)}
                className="flex h-control-primary w-full items-center justify-between text-label font-semibold text-ink"
              >
                {category.label}
                <Icons.disclose
                  className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>

              {isOpen ? (
                <>
                  <label className="flex h-9 items-center gap-1.5 rounded-control border border-hairline bg-card px-1">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink">
                      <Icons.search className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <input
                      value={search[category.id] ?? ""}
                      onChange={(event) => setSearch((prev) => ({ ...prev, [category.id]: event.target.value }))}
                      aria-label={`Search ${category.label.toLowerCase()}`}
                      className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none"
                    />
                  </label>

                  {shown.length > 0 ? (
                    <div className="flex gap-1.5 overflow-x-auto py-2.5 scrollbar-hide">
                      {shown.slice(0, TOP_MATCHES).map((o) => (
                        <Chip
                          key={o.id}
                          label={o.label}
                          active={draft.includes(o.id)}
                          mark={o.label.toLowerCase() === "handloom"}
                          onClick={() => toggle(o.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="py-2.5 text-body text-taupe">Nothing here yet.</p>
                  )}

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 pb-3.5">
                    {shown.map((o) => {
                      const checked = draft.includes(o.id)
                      return (
                        <label key={o.id} className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(o.id)} />
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-control border",
                              checked ? "border-ink bg-ink text-background" : "border-hairline-dashed bg-card",
                            )}
                            aria-hidden="true"
                          >
                            {checked ? <Icons.check className="h-[11px] w-[11px]" strokeWidth={2.5} /> : null}
                          </span>
                          <span className="truncate text-body text-ink">{o.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-4 pb-4 pt-3">
        <button
          type="button"
          onClick={handleClear}
          className="flex h-control-secondary flex-1 items-center justify-center rounded-control border border-ink bg-card text-label font-semibold text-ink"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleApply}
          className="flex h-control-primary flex-1 items-center justify-center rounded-control bg-terracotta text-label font-semibold text-background"
        >
          Apply
        </button>
      </div>
    </BottomSheet>
  )
}
