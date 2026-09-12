import { useEffect, useRef, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Icons } from "@/design-system/icons"
import { useDeleteMoodboard, useRenameMoodboard } from "@/features/collections/hooks/useMoodboards"
import { useToast } from "@/hooks/use-toast"

interface BoardDetailHeaderProps {
  slug: string
  label: string
  /** Omitted where there is no meaningful count to show. */
  itemCount?: number
  /** System boards (Try-ons, Favorites) cannot be renamed or deleted. */
  canManage: boolean
  onBack: () => void
  onDeleted: () => void
}

/**
 * Board detail header — back · name · delete.
 *
 * The name is the edit affordance: tapping it swaps in an input, so there is no
 * pencil. Enter or blur commits, Escape restores. Delete is the only thing
 * behind the trailing icon, and it always confirms.
 */
export function BoardDetailHeader({
  slug,
  label,
  itemCount,
  canManage,
  onBack,
  onDeleted,
}: BoardDetailHeaderProps) {
  const { toast } = useToast()
  const renameMutation = useRenameMoodboard()
  const deleteMutation = useDeleteMoodboard()

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Blur fires on the way out of edit mode too; without this an Escape would
  // commit the discarded draft on its way through.
  const commitOnBlurRef = useRef(true)

  // A rename elsewhere, or switching boards, should not leave a stale draft.
  useEffect(() => {
    setDraft(label)
    setIsEditing(false)
  }, [label, slug])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  const stopEditing = () => {
    commitOnBlurRef.current = false
    setIsEditing(false)
    // Re-arm for the next edit — the blur that closes this one has already run
    // by the time the next frame paints.
    requestAnimationFrame(() => {
      commitOnBlurRef.current = true
    })
  }

  const commit = async () => {
    const next = draft.trim()
    if (!next || next === label) {
      setDraft(label)
      stopEditing()
      return
    }
    stopEditing()
    try {
      await renameMutation.mutateAsync({ slug, label: next })
      toast({ title: "Board renamed", description: next })
    } catch (error) {
      setDraft(label)
      toast({
        title: "Could not rename board",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(slug)
      toast({ title: "Board deleted", description: label })
      setIsConfirmOpen(false)
      onDeleted()
    } catch (error) {
      toast({
        title: "Could not delete board",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="flex items-center gap-2 px-1">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to boards"
        className="flex h-8 w-6 flex-none items-center justify-center text-ink"
      >
        <Icons.carouselPrev className="h-5 w-5" aria-hidden="true" />
      </button>

      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (commitOnBlurRef.current) void commit()
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void commit()
            } else if (event.key === "Escape") {
              event.preventDefault()
              setDraft(label)
              stopEditing()
            }
          }}
          aria-label="Board name"
          maxLength={60}
          className="min-w-0 flex-1 border-b border-ink bg-transparent font-display text-title font-medium text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={canManage ? () => setIsEditing(true) : undefined}
          aria-label={canManage ? `Rename ${label}` : undefined}
          disabled={!canManage}
          className="min-w-0 flex-1 truncate text-left font-display text-title font-medium text-ink disabled:cursor-default"
        >
          {label}
        </button>
      )}

      {typeof itemCount === "number" ? (
        <span className="flex-none text-section font-semibold uppercase tracking-[0.14em] text-faint">
          {itemCount} {itemCount === 1 ? "save" : "saves"}
        </span>
      ) : null}

      {canManage ? (
        <button
          type="button"
          onClick={() => setIsConfirmOpen(true)}
          aria-label={`Delete ${label}`}
          className="flex h-8 w-8 flex-none items-center justify-center text-ink"
        >
          <Icons.remove className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The board goes for good. The looks and pieces saved to it stay in your other
              boards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog up while the delete is in flight.
                event.preventDefault()
                void handleDelete()
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
