import { useMemo, useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { Moodboard } from "@/services/collections/collectionsService"

type PickerMode = "single" | "multi"

export interface MoodboardPickerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  moodboards: Moodboard[]
  defaultSelection?: string
  onSelect: (slug: string) => Promise<void> | void
  mode?: PickerMode
  defaultSelections?: string[]
  onApply?: (slugs: string[]) => Promise<void> | void
  onCreate?: (name: string) => Promise<string | void> | string | void
  isSaving?: boolean
  title?: string
  autoCloseOnSelect?: boolean
  hideHeader?: boolean
}

export function MoodboardPickerDrawer({
  open,
  onOpenChange,
  moodboards,
  defaultSelection,
  onSelect,
  mode = "single",
  defaultSelections,
  onApply,
  onCreate,
  isSaving = false,
  title = "Add to moodboard",
  autoCloseOnSelect = true,
  hideHeader = false,
}: MoodboardPickerDrawerProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(defaultSelection ?? null)
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(
    () => new Set(defaultSelections ?? (defaultSelection ? [defaultSelection] : [])),
  )
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const hasCreate = typeof onCreate === "function"
  const isMulti = mode === "multi"

  const sortedMoodboards = useMemo(
    () => moodboards.slice().sort((a, b) => Number(b.isSystem) - Number(a.isSystem)),
    [moodboards],
  )

  const handleCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setError("Enter a name")
      return
    }
    setError(null)
    try {
      setIsCreating(true)
      const result = await onCreate?.(trimmed)
      if (typeof result === "string") {
        setSelectedSlug(result)
        setSelectedSlugs((prev) => new Set(prev).add(result))
      }
      setNewName("")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create moodboard"
      setError(message)
    } finally {
      setIsCreating(false)
    }
  }

  const handleApply = async () => {
    if (!isMulti) {
      return
    }
    if (!onApply) {
      setError("Select moodboards and try again.")
      return
    }
    setError(null)
    await onApply(Array.from(selectedSlugs))
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        {hideHeader ? (
          <DrawerHeader className="sr-only">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>Select a moodboard.</DrawerDescription>
          </DrawerHeader>
        ) : (
          <DrawerHeader className="flex flex-row items-center justify-between px-6 pb-2">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription className="sr-only">Select a moodboard.</DrawerDescription>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </DrawerHeader>
        )}
        <div className="flex flex-col gap-2 p-5 pb-2 mb-4">
          <div className="flex flex-row gap-2 overflow-x-auto scrollbar-hide">
            {hasCreate ? (
              <button
                type="button"
                className="rounded-full border  border-border px-3 py-1 text-sm text-muted-foreground flex-shrink-0"
                onClick={() => {
                  setError(null)
                  setIsCreating((prev) => !prev)
                }}
              >
                <span className="inline-flex items-center gap-1">
                  <Plus className="h-4 w-4" />
                  Create New
                </span>
              </button>
            ) : null}
            {sortedMoodboards.map((board) => (
              <button
                key={board.slug}
                type="button"
                onClick={async () => {
                  setSelectedSlug(board.slug)
                  setSelectedSlugs((prev) => {
                    const next = new Set(prev)
                    if (isMulti) {
                      if (next.has(board.slug)) next.delete(board.slug)
                      else next.add(board.slug)
                    } else {
                      next.clear()
                      next.add(board.slug)
                    }
                    return next
                  })
                  setError(null)
                  if (!isMulti) {
                    await onSelect(board.slug)
                    if (autoCloseOnSelect) {
                      onOpenChange(false)
                    }
                  }
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm flex-shrink-0",
                  selectedSlugs.has(board.slug)
                    ? "border-foreground bg-muted/60 text-foreground"
                    : "border-border bg-background text-foreground",
                )}
              >
                {board.label}
              </button>
            ))}
          </div>

          {isCreating ? (
            <div className="w-full flex flex-col gap-1 mt-3 p-0 rounded-lg bg-muted/40">
              <div className="flex justify-between items-center px-3 pt-2 ">
                <span className="font-medium text-xs text-foreground">Create moodboard</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setIsCreating(false)}
                  className="h-7 w-7 p-0"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 w-full flex-shrink-0 px-3 pb-3 mt-0">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name your moodboard"
                  disabled={isSaving}
                  className="bg-card text-xs shadow-none placeholder:text-muted-foreground text-foreground placeholder:text-xs h-9 mt-0 w-full"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCreate}
                  disabled={isSaving}
                  className="gap-1 flex-shrink-0 h-9 shadow-none"
                >
                  Save
                </Button>
              </div>
              {error ? (
                <div className="px-4 pb-3">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {isMulti ? (
          <div className="px-6 pb-4 pt-1">
            <Button
              type="button"
              className="w-full"
              onClick={handleApply}
              disabled={isSaving || selectedSlugs.size === 0}
            >
              Apply
            </Button>
          </div>
        ) : null}

      </DrawerContent>
    </Drawer>
  )
}

