import { useEffect, useMemo, useRef, useState } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

export interface StudioSaveBoard {
  slug: string
  label: string
}

export interface StudioSaveCardProps {
  /**
   * What is being saved. Decides the callout and the save label; defaults to
   * "look" when a name is given (the older contract) and "piece" otherwise.
   */
  kind?: "look" | "piece"
  /** Omit to hide the name row. */
  defaultName?: string
  /** Derived tags on offer as toggle chips, drawn from the worn pieces. */
  tagOptions?: string[]
  /** Stored tags when editing an existing save — pre-selects matching options, rest become custom. */
  initialTags?: string[]
  boards: StudioSaveBoard[]
  /** Look saves: how many pieces are worn, for the "save look · N pieces" callout. */
  pieceCount?: number
  /** Fits Studio's 170px band: no callout line, shorter field and buttons. */
  compact?: boolean
  defaultBoardSlugs?: string[]
  isSaving?: boolean
  onSave: (data: { name: string; tags: string[]; boardSlugs: string[] }) => void
  onCancel: () => void
  onCreateBoard?: (name: string) => Promise<string | undefined>
  className?: string
}

const CHIP =
  "box-border inline-flex h-control-chip flex-none items-center gap-1 whitespace-nowrap rounded-chip px-2 text-chip tracking-normal"
/** The rails bleed to the frame edge, so a chip can scroll off rather than clip. */
const RAIL = "-mx-4 flex flex-none items-center gap-1.5 overflow-x-auto px-4 scrollbar-hide"

interface PillRailProps {
  items: StudioSaveBoard[]
  activeKeys: string[]
  /** Keys active when the card opened; they lead the rail and never move after. */
  initialActiveKeys: Set<string>
  /** Keys created from this rail, newest first; they sit right after the create pill. */
  createdKeys: string[]
  createLabel: string
  placeholder: string
  onToggle: (key: string) => void
  onCreate?: (label: string) => void | Promise<void>
}

/** Created pills first (newest leading), then pills that were on at open, then the rest. */
function orderPills(items: StudioSaveBoard[], initialActiveKeys: Set<string>, createdKeys: string[]) {
  const created = createdKeys.map((key) => items.find((item) => item.slug === key)).filter((item): item is StudioSaveBoard => Boolean(item))
  const lead = items.filter((item) => initialActiveKeys.has(item.slug) && !createdKeys.includes(item.slug))
  const rest = items.filter((item) => !initialActiveKeys.has(item.slug) && !createdKeys.includes(item.slug))
  return [...created, ...lead, ...rest]
}

/**
 * One scrollable row of pills: the create pill, then the ordered pills.
 * Toggling never reorders, or a chip would jump under the finger.
 */
function PillRail({ items, activeKeys, initialActiveKeys, createdKeys, createLabel, placeholder, onToggle, onCreate }: PillRailProps) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const ordered = useMemo(() => orderPills(items, initialActiveKeys, createdKeys), [createdKeys, initialActiveKeys, items])

  const commit = () => {
    const label = draft.trim()
    setDraft("")
    setAdding(false)
    if (label && onCreate) void onCreate(label)
  }

  return (
    <div className={RAIL}>
      {onCreate ? (
        adding ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commit()
              }
              if (event.key === "Escape") {
                setDraft("")
                setAdding(false)
              }
            }}
            placeholder={placeholder}
            className={cn(CHIP, "w-28 border border-hairline bg-white text-ink outline-none")}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(CHIP, "border border-dashed border-hairline-dashed bg-white text-ink")}
          >
            <Icons.add className="h-[11px] w-[11px]" strokeWidth={2} aria-hidden="true" />
            {createLabel}
          </button>
        )
      ) : null}
      {ordered.map((item) => {
        const on = activeKeys.includes(item.slug)
        return (
          <button
            key={item.slug}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(item.slug)}
            className={cn(
              CHIP,
              // V2: active pill = 1.5px violet border and violet text, no fill.
              on ? "border-[1.5px] border-violet bg-white text-violet" : "border border-hairline bg-white text-ink",
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

const tagKey = (label: string) => label.trim().toLowerCase()

/**
 * Save, in place of the slot rows — name, tags, boards, then Save/Cancel.
 * Replaces the drawer on this screen; the artboard puts it inside the 170h card.
 */
export function StudioSaveCard({
  kind,
  defaultName,
  tagOptions = [],
  initialTags = [],
  boards,
  pieceCount,
  compact = false,
  defaultBoardSlugs = [],
  isSaving = false,
  onSave,
  onCancel,
  onCreateBoard,
  className,
}: StudioSaveCardProps) {
  const isLook = (kind ?? (defaultName !== undefined ? "look" : "piece")) === "look"
  const hasDetails = defaultName !== undefined
  const [name, setName] = useState(defaultName ?? "")

  // Tags: derived options plus the user's own. A stored tag that matches an option
  // pre-selects it; any other stored tag comes back as a custom pill.
  const [customTags, setCustomTags] = useState<string[]>(() =>
    initialTags.filter((tag) => !tagOptions.some((option) => tagKey(option) === tagKey(tag))),
  )
  const [selectedTags, setSelectedTags] = useState<string[]>(() => [
    ...tagOptions.filter((option) => initialTags.some((tag) => tagKey(tag) === tagKey(option))),
    ...initialTags.filter((tag) => !tagOptions.some((option) => tagKey(option) === tagKey(tag))),
  ])
  const [createdTags, setCreatedTags] = useState<string[]>([])
  const initialActiveTags = useRef(new Set(selectedTags)).current
  const tagItems = useMemo(
    () => [...customTags, ...tagOptions].map((tag) => ({ slug: tag, label: tag })),
    [customTags, tagOptions],
  )
  const toggleTag = (tag: string) => {
    const isCustom = customTags.includes(tag)
    if (selectedTags.includes(tag)) {
      setSelectedTags((prev) => prev.filter((t) => t !== tag))
      // A custom pill switched off is gone; there is nothing to leave behind.
      if (isCustom) {
        setCustomTags((prev) => prev.filter((t) => t !== tag))
        setCreatedTags((prev) => prev.filter((t) => t !== tag))
      }
      return
    }
    setSelectedTags((prev) => [...prev, tag])
  }

  const createTag = (label: string) => {
    const existing = tagItems.find((item) => tagKey(item.slug) === tagKey(label))
    if (existing) {
      if (!selectedTags.includes(existing.slug)) setSelectedTags((prev) => [...prev, existing.slug])
      return
    }
    setCustomTags((prev) => [label, ...prev])
    setSelectedTags((prev) => [...prev, label])
    setCreatedTags((prev) => [label, ...prev])
  }

  // Boards.
  const [boardSlugs, setBoardSlugs] = useState<string[]>(defaultBoardSlugs)
  const [createdBoards, setCreatedBoards] = useState<string[]>([])
  const initialActiveSlugs = useRef(new Set(defaultBoardSlugs)).current

  const toggleBoard = (slug: string) =>
    setBoardSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))

  const createBoard = async (label: string) => {
    if (!onCreateBoard) return
    const slug = await onCreateBoard(label)
    if (slug) {
      setBoardSlugs((prev) => [...prev, slug])
      setCreatedBoards((prev) => [slug, ...prev])
    }
  }

  const tagsInRailOrder = () =>
    orderPills(tagItems, initialActiveTags, createdTags)
      .map((item) => item.slug)
      .filter((tag) => selectedTags.includes(tag))

  return (
    <div className={cn("flex flex-1 flex-col justify-start", compact ? "gap-1" : "gap-1.5", className)}>
      {/* Callout row: what is being saved. */}
      {compact ? null : (
        <p className="text-chip text-taupe">
          {isLook
            ? typeof pieceCount === "number"
              ? `save look · ${pieceCount} ${pieceCount === 1 ? "piece" : "pieces"}`
              : "save look"
            : "save item"}
        </p>
      )}
      {hasDetails ? (
        <label className={cn("box-border flex flex-none items-center gap-1.5 rounded-control border border-hairline bg-white pl-2.5 pr-1", compact ? "h-9" : "h-11")}>
          <span className="sr-only">Look name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this look"
            className="min-w-0 flex-1 truncate bg-transparent text-label font-medium text-ink outline-none placeholder:text-taupe"
          />
        </label>
      ) : null}

      <PillRail
        items={tagItems}
        activeKeys={selectedTags}
        initialActiveKeys={initialActiveTags}
        createdKeys={createdTags}
        createLabel="tag"
        placeholder="Tag"
        onToggle={toggleTag}
        onCreate={createTag}
      />

      <PillRail
        items={boards}
        activeKeys={boardSlugs}
        initialActiveKeys={initialActiveSlugs}
        createdKeys={createdBoards}
        createLabel="board"
        placeholder="Board name"
        onToggle={toggleBoard}
        onCreate={onCreateBoard ? createBoard : undefined}
      />

      {/* V2 order: cancel (white) · save (ink). */}
      <div className="mt-auto flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "box-border flex flex-1 items-center justify-center gap-2 rounded-control",
            compact ? "h-control-secondary" : "h-control-primary",
            "border border-hairline bg-white text-label font-semibold text-ink",
          )}
        >
          <Icons.close className="h-5 w-5" aria-hidden="true" />
          cancel
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => onSave({ name: name.trim() || (defaultName ?? ""), tags: tagsInRailOrder(), boardSlugs })}
          className={cn(
            "box-border flex flex-1 items-center justify-center gap-2 rounded-control",
            compact ? "h-control-secondary" : "h-control-primary",
            "bg-primary text-label font-semibold text-primary-foreground disabled:opacity-60",
          )}
        >
          <Icons.save className="h-5 w-5" aria-hidden="true" />
          {isSaving ? "saving…" : isLook ? "save" : "save item"}
        </button>
      </div>
    </div>
  )
}
