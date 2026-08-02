import { useEffect, useMemo, useRef, useState } from "react"
import { Bookmark, Check, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCategories, useOccasions } from "@/features/outfits/hooks/useOutfitOptions"
import type { Moodboard } from "@/services/collections/collectionsService"
import { useViewportZoomLockController } from "@/hooks/useViewportZoomLock"

export interface SaveOutfitDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: "save" | "edit"
  defaultOutfitName?: string
  defaultCategoryId?: string
  defaultOccasionId?: string
  defaultVibe?: string | null
  defaultKeywords?: string | null
  defaultIsPrivate?: boolean
  defaultMoodboardIds?: string[]
  moodboards?: Moodboard[]
  isLoadingMoodboards?: boolean

  onCreateMoodboard?: (name: string) => Promise<string | void> | string | void
  onSave?: (data: {
    outfitName: string
    categoryId: string
    occasionId: string
    vibe: string
    keywords: string
    isPrivate: boolean
    moodboardIds?: string[]
  }) => Promise<void> | void
  onDelete?: () => Promise<void> | void
}

export function SaveOutfitDrawer({
  open,
  onOpenChange,
  mode = "save",
  defaultOutfitName = "",
  defaultCategoryId,
  defaultOccasionId,
  defaultVibe = "",
  defaultKeywords = "",
  defaultIsPrivate = false,
  defaultMoodboardIds,
  moodboards = [],
  isLoadingMoodboards = false,

  onCreateMoodboard,
  onSave = async () => { },
  onDelete,
}: SaveOutfitDrawerProps) {
  const isEditMode = mode === "edit"
  const [outfitName, setOutfitName] = useState(defaultOutfitName)
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? "")
  const [occasionId, setOccasionId] = useState<string>(defaultOccasionId ?? "")
  const [vibe, setVibe] = useState(defaultVibe)
  const [keywords, setKeywords] = useState(defaultKeywords)
  const [isPrivate, setIsPrivate] = useState(defaultIsPrivate)
  const [selectedMoodboardIds, setSelectedMoodboardIds] = useState<string[]>(defaultMoodboardIds ?? [])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newMoodboardName, setNewMoodboardName] = useState("")
  const [createError, setCreateError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const outfitNameRef = useRef<HTMLInputElement | null>(null)
  const { lock: lockViewportZoom, unlock: unlockViewportZoom } = useViewportZoomLockController()

  const selectableMoodboards = useMemo(() => moodboards.filter((m) => !m.isSystem), [moodboards])

  const { data: categories = [], isLoading: categoriesLoading } = useCategories(50)
  const { data: occasions = [], isLoading: occasionsLoading } = useOccasions(50)

  // Sync state when props change (for when outfit data loads after drawer opens)
  useEffect(() => {
    setOutfitName(defaultOutfitName)
  }, [defaultOutfitName])

  useEffect(() => {
    setCategoryId(defaultCategoryId ?? "")
  }, [defaultCategoryId])

  useEffect(() => {
    setOccasionId(defaultOccasionId ?? "")
  }, [defaultOccasionId])

  useEffect(() => {
    setVibe(defaultVibe)
  }, [defaultVibe])

  useEffect(() => {
    setKeywords(defaultKeywords)
  }, [defaultKeywords])

  useEffect(() => {
    setIsPrivate(defaultIsPrivate)
  }, [defaultIsPrivate])

  useEffect(() => {
    setSelectedMoodboardIds(defaultMoodboardIds ?? [])
  }, [defaultMoodboardIds])

  useEffect(() => {
    if (open) {
      lockViewportZoom()
      return () => {
        unlockViewportZoom()
      }
    }
    unlockViewportZoom()
    return undefined
  }, [lockViewportZoom, open, unlockViewportZoom])

  const isValid = useMemo(
    () => Boolean(outfitName.trim() && categoryId && occasionId),
    [categoryId, occasionId, outfitName],
  )

  const handleSave = async () => {
    if (!isValid || isSubmitting) {
      setSubmitError("Please fill in the required fields.")
      return
    }

    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await onSave({
        outfitName: outfitName.trim(),
        categoryId,
        occasionId,
        vibe,
        keywords,
        isPrivate,
        moodboardIds: selectedMoodboardIds.length ? selectedMoodboardIds : undefined,
      })
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save outfit"
      setSubmitError(message)
    } finally {
      setIsSubmitting(false)
    }
  }



  const handleClear = () => {
    setOutfitName("")
    setCategoryId("")
    setOccasionId("")
    setVibe("")
    setKeywords("")
    setIsPrivate(false)
    setSelectedMoodboardIds([])
    setSubmitError(null)
  }

  const handleDeleteConfirmed = async () => {
    setIsSubmitting(true)
    try {
      await onDelete?.()
      onOpenChange(false)
    } catch {
      setSubmitError("Delete failed. Try again.")
    } finally {
      setIsSubmitting(false)
      setConfirmDelete(false)
    }
  }

  const handleCreateNewMoodboard = async () => {
    if (!onCreateMoodboard) return
    const name = newMoodboardName.trim()
    if (!name) {
      setCreateError("Enter a name")
      return
    }
    setCreateError(null)
    try {
      const result = await onCreateMoodboard(name)
      if (typeof result === "string") {
        setSelectedMoodboardIds((prev) => (prev.includes(result) ? prev : [...prev, result]))
      }
      setNewMoodboardName("")
      setIsCreating(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create moodboard"
      setCreateError(message)
    }
  }

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          className="max-h-[90vh] w-[94%] max-w-[600px] mx-auto"
          onOpenAutoFocus={(event) => {
            if (outfitNameRef.current) {
              lockViewportZoom()
              event.preventDefault()
              outfitNameRef.current.focus()
            }
          }}
        >
          <DrawerHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-1">
            <div className="sr-only">
              <DrawerTitle>{isEditMode ? "Edit outfit" : "Save outfit to collection"}</DrawerTitle>
              <DrawerDescription>{isEditMode ? "Edit outfit details and moodboards." : "Provide outfit details and choose moodboards."}</DrawerDescription>
            </div>

            <span className="text-[8.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {isEditMode ? "Edit this look" : "Save this look"}
            </span>

            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="-mr-2 h-7 w-7">
                <X className="h-3.5 w-3.5" />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <Separator className="my-2 bg-hairline" />

          <div className="relative px-5 w-full mx-auto max-h-[80vh] overflow-y-auto">
            <div className="w-full space-y-1 pb-4">
              <div className="flex flex-row gap-2 mx-auto w-full overflow-x-hidden ">
                {/* Outfit Name */}
                <div className="w-[50%] p-1 space-y-1 min-w-0 overflow-hidden">
                  <Label htmlFor="outfit-name" className="pl-0.5 text-[7.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Outfit Name
                  </Label>
                  <Input
                    id="outfit-name"
                    placeholder="E.g., Summer Casual Look"
                    value={outfitName}
                    onChange={(e) => setOutfitName(e.target.value)}
                    className="bg-card text-sm h-9 shadow-none placeholder:text-muted-foreground text-foreground placeholder:text-sm"
                    ref={outfitNameRef}
                  />
                </div>

                {/* Category */}
                <div className="flex-1 space-y-1 min-w-0 overflow-hidden p-1">
                  <Label className="pl-0.5 text-[7.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Category</Label>
                  <Select value={categoryId} onValueChange={setCategoryId} disabled={categoriesLoading}>
                    <SelectTrigger className="bg-card text-sm h-9 shadow-none placeholder:text-muted-foreground text-foreground placeholder:text-sm">
                      <SelectValue placeholder={categoriesLoading ? "Loading…" : "Select category"} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>


              <div className="flex flex-row gap-2">
                {/* Occasion */}
                <div className="flex-1 p-1 space-y-1 min-w-0 overflow-hidden">
                  <Label className="pl-0.5 text-[7.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Occasion</Label>
                  <Select value={occasionId} onValueChange={setOccasionId} disabled={occasionsLoading}>
                    <SelectTrigger className="bg-card text-sm h-9 shadow-none placeholder:text-muted-foreground text-foreground placeholder:text-sm">
                      <SelectValue placeholder={occasionsLoading ? "Loading…" : "Select occasion"} />
                    </SelectTrigger>
                    <SelectContent>
                      {occasions.map((occasion) => (
                        <SelectItem key={occasion.id} value={occasion.id}>
                          {occasion.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Vibe */}
                <div className="flex-1 p-1 space-y-1 min-w-0 overflow-hidden">
                  <Label htmlFor="vibe" className="pl-0.5 text-[7.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Vibe
                  </Label>
                  <Input
                    id="vibe"
                    placeholder="E.g., Chic, Casual, Bold"
                    value={vibe ?? ""}
                    onChange={(e) => setVibe(e.target.value)}
                    className="bg-card text-sm h-9 shadow-none placeholder:text-muted-foreground text-foreground placeholder:text-sm"
                  />
                </div>
              </div>

              {/* Keywords */}
              <div className="p-1 space-y-1">
                <Label htmlFor="keywords" className="pl-0.5 text-[7.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Keywords
                </Label>
                <Textarea
                  id="keywords"
                  placeholder="Summer, Casual, Streetstyle"
                  value={keywords ?? ""}
                  onChange={(e) => setKeywords(e.target.value)}
                  className="bg-card text-sm h-9 shadow-none placeholder:text-muted-foreground text-foreground placeholder:text-sm"
                />
              </div>

              {/* To board — tag chips, not a list.
                  The old rail was a horizontal scroller with "Create" pinned to
                  its left, so boards past the third were invisible and you
                  couldn't see what was already ticked without scrolling back.
                  Boards are a small, flat set: wrapping multi-select chips show
                  the whole vocabulary and every current selection at a glance,
                  and "+ New board" sits in the same row as one more chip. */}
              <div className="space-y-1 p-1">
                <Label className="pl-0.5 text-[7.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  To board
                </Label>

                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {isLoadingMoodboards ? (
                    <p className="text-[9px] text-muted-foreground">Loading boards…</p>
                  ) : (
                    <>
                      {selectableMoodboards.map((moodboard) => {
                        const isSelected = selectedMoodboardIds.includes(moodboard.slug)
                        return (
                          <button
                            key={moodboard.slug}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() =>
                              setSelectedMoodboardIds((prev) =>
                                prev.includes(moodboard.slug)
                                  ? prev.filter((slug) => slug !== moodboard.slug)
                                  : [...prev, moodboard.slug],
                              )
                            }
                            disabled={isSubmitting}
                            className={cn(
                              "inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border px-2.5 py-1.5",
                              "text-[9.5px] font-medium transition-colors disabled:opacity-60",
                              isSelected
                                ? "border-ink bg-ink text-on-ink-1"
                                : "border-hairline-4 bg-card text-ink-body hover:border-ink-line",
                            )}
                          >
                            {moodboard.label}
                            {isSelected && <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />}
                          </button>
                        )
                      })}

                      {onCreateMoodboard ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCreateError(null)
                            setIsCreating((prev) => !prev)
                          }}
                          disabled={isSubmitting}
                          className={cn(
                            "inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border border-dashed px-2.5 py-1.5",
                            "text-[9.5px] font-medium transition-colors disabled:opacity-60",
                            isCreating
                              ? "border-terracotta text-terracotta"
                              : "border-hairline-4 text-muted-foreground hover:border-ink-line",
                          )}
                        >
                          <Plus className="size-2.5" aria-hidden="true" />
                          New board
                        </button>
                      ) : null}

                      {selectableMoodboards.length === 0 && !onCreateMoodboard ? (
                        <p className="text-[9px] text-muted-foreground">No boards yet</p>
                      ) : null}
                    </>
                  )}
                </div>

                {createError ? <p className="pt-1 text-[9px] text-destructive">{createError}</p> : null}

                {isCreating ? (
                  <div className="mt-1.5 flex items-center gap-1.5 rounded-[4px] border border-hairline bg-muted/30 p-2">
                    <Input
                      value={newMoodboardName}
                      onChange={(e) => setNewMoodboardName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          void handleCreateNewMoodboard()
                        }
                      }}
                      placeholder="Name your board"
                      autoFocus
                      disabled={isSubmitting}
                      className="h-8 rounded-[3px] border-hairline-4 bg-card text-[10px] shadow-none placeholder:text-[10px] placeholder:text-muted-foreground"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCreateNewMoodboard}
                      disabled={isSubmitting}
                      className="h-8 shrink-0 rounded-[3px] border-hairline-4 px-3 text-[10px] shadow-none"
                    >
                      Add
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <Separator className="" />

          {/* Footer */}
          <DrawerFooter className="px-6 pb-5 pt-3 flex flex-col gap-2">
            {submitError ? <p className="text-xs text-destructive text-center">{submitError}</p> : null}
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 w-full">

              {/* Left: Delete / Clear / Confirm+Cancel */}
              <div className="shrink-0">
                {confirmDelete ? (
                  <div className="flex flex-col items-start gap-0.5">
                    <button
                      type="button"
                      onClick={handleDeleteConfirmed}
                      disabled={isSubmitting}
                      className="text-[11px] font-medium text-destructive underline underline-offset-2 whitespace-nowrap leading-4"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-[11px] font-medium text-muted-foreground underline underline-offset-2 whitespace-nowrap leading-4"
                    >
                      Cancel
                    </button>
                  </div>
                ) : isEditMode ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="text-[11px] font-medium text-muted-foreground underline underline-offset-2 hover:text-destructive whitespace-nowrap"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="text-[11px] font-medium text-muted-foreground underline underline-offset-2 whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Center: Save — the screen's one filled terracotta. */}
              <Button
                onClick={handleSave}
                className="h-9 w-full min-w-0 gap-1.5 rounded-[3px] bg-primary px-3 text-[11px] font-bold text-primary-foreground hover:bg-primary/90"
                disabled={!isValid || isSubmitting || categoriesLoading || occasionsLoading}
              >
                <Bookmark className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {isSubmitting ? "Saving…" : isEditMode ? "Save changes" : "Save"}
                </span>
              </Button>

              {/* Right: Pvt Only toggle button */}
              <button
                type="button"
                role="switch"
                aria-checked={isPrivate}
                onClick={() => setIsPrivate((v) => !v)}
                className={cn(
                  "shrink-0 flex items-center gap-1 h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors duration-150 whitespace-nowrap",
                  isPrivate ? "text-foreground" : "text-muted-foreground/40",
                )}
              >
                <Check
                  className={cn("h-3 w-3 shrink-0 transition-opacity duration-150", isPrivate ? "opacity-100" : "opacity-0")}
                  strokeWidth={2.5}
                />
                Pvt Only
              </button>

            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}

