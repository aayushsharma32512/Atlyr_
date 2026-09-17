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
  /** Omit to hide the name and tag rows. */
  defaultName?: string
  /** Suggested tags, drawn from the worn pieces. */
  defaultTags?: string[]
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

/**
 * Save, in place of the slot rows — name, tags, boards, then Save/Cancel.
 * Replaces the drawer on this screen; the artboard puts it inside the 170h card.
 */
export function StudioSaveCard({
  kind,
  defaultName,
  defaultTags = [],
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
  const [tags, setTags] = useState<string[]>(defaultTags)
  const [boardSlugs, setBoardSlugs] = useState<string[]>(defaultBoardSlugs)
  const [addingTag, setAddingTag] = useState(false)
  const [draftTag, setDraftTag] = useState("")
  const tagInputRef = useRef<HTMLInputElement>(null)
  const [addingBoard, setAddingBoard] = useState(false)
  const [draftBoard, setDraftBoard] = useState("")
  const boardInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus()
  }, [addingTag])
  useEffect(() => {
    if (addingBoard) boardInputRef.current?.focus()
  }, [addingBoard])

  const commitTag = () => {
    const value = draftTag.trim()
    if (value && !tags.includes(value)) setTags((prev) => [...prev, value])
    setDraftTag("")
    setAddingTag(false)
  }

  const toggleBoard = (slug: string) =>
    setBoardSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))

  // Boards this item is already in, at open time — frozen for the life of the
  // card. Re-deriving this from `boardSlugs` on every toggle would make a chip
  // jump to the front the moment the user taps it, mid-selection.
  const initialActiveSlugs = useRef(new Set(defaultBoardSlugs)).current
  const orderedBoards = useMemo(() => {
    const active = boards.filter((board) => initialActiveSlugs.has(board.slug))
    const rest = boards.filter((board) => !initialActiveSlugs.has(board.slug))
    return [...active, ...rest]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialActiveSlugs is frozen for this card's lifetime
  }, [boards])

  const commitBoard = async () => {
    const label = draftBoard.trim()
    setDraftBoard("")
    setAddingBoard(false)
    if (!label || !onCreateBoard) return
    const slug = await onCreateBoard(label)
    if (slug) setBoardSlugs((prev) => [...prev, slug])
  }

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
      <>
      <label className={cn("box-border flex flex-none items-center gap-1.5 rounded-control border border-hairline bg-white pl-2.5 pr-1", compact ? "h-9" : "h-11")}>
        <span className="sr-only">Look name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this look"
          className="min-w-0 flex-1 truncate bg-transparent text-label font-medium text-ink outline-none placeholder:text-taupe"
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
            className={cn(CHIP, "w-24 border border-hairline bg-white text-ink outline-none")}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingTag(true)}
            className={cn(CHIP, "border border-dashed border-hairline-dashed bg-white text-ink")}
          >
            <Icons.add className="h-[11px] w-[11px] flex-none text-ink" strokeWidth={2} aria-hidden="true" />
            add tag
          </button>
        )}
        {/* The chip is a label, not a button — removing is the × alone, or a tap
            anywhere on it deleted the tag by accident. */}
        {tags.map((tag) => (
          <span key={tag} className={cn(CHIP, "border border-hairline bg-white text-ink")}>
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
      </>
      ) : null}

      <div className={RAIL}>
        {onCreateBoard ? (
          addingBoard ? (
            <input
              ref={boardInputRef}
              value={draftBoard}
              onChange={(event) => setDraftBoard(event.target.value)}
              onBlur={() => void commitBoard()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commitBoard()
                if (event.key === "Escape") {
                  setDraftBoard("")
                  setAddingBoard(false)
                }
              }}
              placeholder="Board name"
              className={cn(CHIP, "w-28 border border-hairline bg-white text-ink outline-none")}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingBoard(true)}
              className={cn(CHIP, "border border-dashed border-hairline-dashed bg-white text-ink")}
            >
              <Icons.add className="h-[11px] w-[11px]" strokeWidth={2} aria-hidden="true" />
              new
            </button>
          )
        ) : null}
        {orderedBoards.map((board) => {
          const on = boardSlugs.includes(board.slug)
          return (
            <button
              key={board.slug}
              type="button"
              aria-pressed={on}
              onClick={() => toggleBoard(board.slug)}
              className={cn(
                CHIP,
                // V2: active board = 1.5px violet border and violet text, no fill.
                on ? "border-[1.5px] border-violet bg-white text-violet" : "border border-hairline bg-white text-ink",
              )}
            >
              {board.label}
            </button>
          )
        })}
      </div>

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
          onClick={() => onSave({ name: name.trim() || (defaultName ?? ""), tags, boardSlugs })}
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
