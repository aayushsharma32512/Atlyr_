import { useEffect, useRef, useState } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

export interface StudioSaveBoard {
  slug: string
  label: string
}

export interface StudioSaveCardProps {
  defaultName: string
  /** Suggested tags, drawn from the worn pieces. */
  defaultTags?: string[]
  boards: StudioSaveBoard[]
  defaultBoardSlugs?: string[]
  isSaving?: boolean
  onSave: (data: { name: string; tags: string[]; boardSlugs: string[] }) => void
  onCancel: () => void
  onCreateBoard?: (name: string) => Promise<string | undefined>
  className?: string
}

const CHIP =
  "box-border inline-flex h-control-chip flex-none items-center gap-1 whitespace-nowrap rounded-control px-2 text-chip tracking-[0.06em]"
/** The rails bleed to the frame edge, so a chip can scroll off rather than clip. */
const RAIL = "-mx-4 flex flex-none items-center gap-1.5 overflow-x-auto px-4 scrollbar-hide"

/**
 * Save, in place of the slot rows — name, tags, boards, then Save/Cancel.
 * Replaces the drawer on this screen; the artboard puts it inside the 170h card.
 */
export function StudioSaveCard({
  defaultName,
  defaultTags = [],
  boards,
  defaultBoardSlugs = [],
  isSaving = false,
  onSave,
  onCancel,
  onCreateBoard,
  className,
}: StudioSaveCardProps) {
  const [name, setName] = useState(defaultName)
  const [tags, setTags] = useState<string[]>(defaultTags)
  const [boardSlugs, setBoardSlugs] = useState<string[]>(defaultBoardSlugs)
  const [addingTag, setAddingTag] = useState(false)
  const [draftTag, setDraftTag] = useState("")
  const tagInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus()
  }, [addingTag])

  const commitTag = () => {
    const value = draftTag.trim()
    if (value && !tags.includes(value)) setTags((prev) => [...prev, value])
    setDraftTag("")
    setAddingTag(false)
  }

  const toggleBoard = (slug: string) =>
    setBoardSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))

  const createBoard = async () => {
    const label = window.prompt("Name your board")?.trim()
    if (!label || !onCreateBoard) return
    const slug = await onCreateBoard(label)
    if (slug) setBoardSlugs((prev) => [...prev, slug])
  }

  return (
    <div className={cn("flex flex-1 flex-col justify-start gap-1.5", className)}>
      <label className="box-border flex h-[34px] flex-none items-center gap-1.5 rounded-control border border-hairline bg-card/60 pl-2.5 pr-1">
        <span className="sr-only">Look name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this look"
          className="min-w-0 flex-1 truncate bg-transparent text-body text-ink outline-none placeholder:text-taupe"
        />
      </label>

      <div className={RAIL}>
        {addingTag ? (
          <input
            ref={tagInputRef}
            value={draftTag}
            onChange={(event) => setDraftTag(event.target.value)}
            onBlur={commitTag}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitTag()
              if (event.key === "Escape") {
                setDraftTag("")
                setAddingTag(false)
              }
            }}
            placeholder="Tag"
            className={cn(CHIP, "w-24 border border-hairline bg-card/60 text-ink outline-none")}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingTag(true)}
            className={cn(CHIP, "w-[33%] border border-hairline bg-card/60 text-taupe")}
          >
            <Icons.add className="h-[11px] w-[11px] flex-none text-ink" strokeWidth={2} aria-hidden="true" />
            Add tag
          </button>
        )}
        {/* The chip is a label, not a button — removing is the × alone, or a tap
            anywhere on it deleted the tag by accident. */}
        {tags.map((tag) => (
          <span key={tag} className={cn(CHIP, "border border-hairline bg-card text-ink")}>
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
              className="-mr-0.5 flex h-4 w-4 flex-none items-center justify-center text-taupe"
            >
              <Icons.close className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>

      <div className={RAIL}>
        {onCreateBoard ? (
          <button
            type="button"
            onClick={() => void createBoard()}
            className={cn(CHIP, "border border-dashed border-hairline-dashed bg-card/45 text-ink")}
          >
            <Icons.add className="h-[11px] w-[11px]" strokeWidth={2} aria-hidden="true" />
            New
          </button>
        ) : null}
        {boards.map((board) => {
          const on = boardSlugs.includes(board.slug)
          return (
            <button
              key={board.slug}
              type="button"
              aria-pressed={on}
              onClick={() => toggleBoard(board.slug)}
              className={cn(
                CHIP,
                on ? "border border-ink bg-ink text-background" : "border border-hairline bg-card text-ink",
              )}
            >
              {board.label}
            </button>
          )
        })}
      </div>

      <div className="mt-auto flex flex-none items-center gap-2">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => onSave({ name: name.trim() || defaultName, tags, boardSlugs })}
          className={cn(
            "box-border flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control",
            "bg-terracotta text-label font-semibold text-background disabled:opacity-60",
          )}
        >
          <Icons.save className="h-5 w-5" aria-hidden="true" />
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "box-border flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control",
            "border border-hairline bg-card/60 text-label font-semibold text-ink",
          )}
        >
          <Icons.close className="h-5 w-5" aria-hidden="true" />
          Cancel
        </button>
      </div>
    </div>
  )
}
