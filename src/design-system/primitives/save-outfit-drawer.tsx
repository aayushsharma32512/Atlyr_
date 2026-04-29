import { useEffect, useMemo, useRef, useState } from "react"
import { X, Plus, Check } from "lucide-react"
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
          <DrawerHeader className="flex flex-row items-center justify-between px-6 pb-1 pt-0">
            <div className="sr-only">
              <DrawerTitle>{isEditMode ? "Edit outfit" : "Save outfit to collection"}</DrawerTitle>
              <DrawerDescription>{isEditMode ? "Edit outfit details and moodboards." : "Provide outfit details and choose moodboards."}</DrawerDescription>
            </div>

            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <Separator className="my-1 mb-2 " />

          <div className="relative px-5 w-full mx-auto max-h-[80vh] overflow-y-auto">
            <div className="w-full space-y-1 pb-4">
              <div className="flex flex-row gap-2 mx-auto w-full overflow-x-hidden ">
                {/* Outfit Name */}
                <div className="w-[50%] p-1 space-y-1 min-w-0 overflow-hidden">
                  <Label htmlFor="outfit-name" className="text-xs font-thin pl-0.5">
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
                  <Label className="text-xs font-thin pl-0.5">Category</Label>
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
                  <Label className="text-xs font-thin pl-0.5">Occasion</Label>
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
                  <Label htmlFor="vibe" className="text-xs font-thin pl-0.5">
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
                <Label htmlFor="keywords" className="text-xs font-thin pl-0.5">
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

              {/* Add to Moodboard */}
              <div className="space-y-1 p-1">
                  <Label className="text-xs font-thin pl-0.5">Add to Moodboard</Label>

               

                <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
                  {isLoadingMoodboards ? (
                    <p className="text-sm text-muted-foreground">Loading moodboards…</p>
                  ) : onCreateMoodboard ? (
                    <>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setCreateError(null)
                          setIsCreating((prev) => !prev)
                        }}
                        className="gap-1 h-9 border-border rounded-full bg-background hover:bg-background outline-none flex-shrink-0"
                        disabled={isSubmitting}
                        size="sm"
                      >
                        Create
                        <Plus className="h-4 w-4" />
                      </Button>
                      {/* {isCreating ? (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Input
                              value={newMoodboardName}
                              onChange={(e) => setNewMoodboardName(e.target.value)}
                              placeholder="Name your moodboard"
                              disabled={isSubmitting}
                              className="bg-card rounded-full text-xs w-48 shadow-none placeholder:text-muted-foreground text-foreground placeholder:text-xs h-9"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleCreateNewMoodboard}
                              disabled={isSubmitting}
                              className="gap-1 flex-shrink-0"
                            >
                              <Plus className="h-4 w-4" />
                              Save
                            </Button>
                          </div>
                        ) : null} */}
                    </>
                  ) : null}
                  {!isLoadingMoodboards && moodboards.length > 0
                    ? selectableMoodboards.map((moodboard) => (
                      <Button
                        key={moodboard.slug}
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setSelectedMoodboardIds((prev) =>
                            prev.includes(moodboard.slug)
                              ? prev.filter((slug) => slug !== moodboard.slug)
                              : [...prev, moodboard.slug],
                          )
                        }
                        disabled={isSubmitting}
                        className={cn(
                          "border-border rounded-full text-foreground bg-background hover:bg-background outline-none flex-shrink-0 whitespace-nowrap",
                          selectedMoodboardIds.includes(moodboard.slug) && "border-muted-foreground bg-muted/50",
                        )}
                      >
                        {moodboard.label}
                      </Button>
                    ))
                    : null}
                  {!isLoadingMoodboards && selectableMoodboards.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No moodboards yet</p>
                  ) : null}
                  {createError ? <p className="text-sm text-destructive w-full">{createError}</p> : null}
                </div>

                
                {isCreating ? (
                  <div className="w-full flex flex-col gap-1 mt-0 p-0 rounded-lg bg-muted/40">
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
                        value={newMoodboardName}
                        onChange={(e) => setNewMoodboardName(e.target.value)}
                        placeholder="Name your moodboard"
                        disabled={isSubmitting}
                        className="bg-card  text-xs shadow-none placeholder:text-muted-foreground text-foreground placeholder:text-xs h-9 mt-0 w-full"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCreateNewMoodboard}
                        disabled={isSubmitting}
                        className="gap-1 flex-shrink-0 h-9 shadow-none"
                      >
                        Save
                      </Button>
                    </div>
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

              {/* Center: Save button */}
              <Button
                onClick={handleSave}
                className="w-full min-w-0 bg-foreground text-background hover:bg-foreground/90 h-8 rounded-lg text-xs px-3"
                disabled={!isValid || isSubmitting || categoriesLoading || occasionsLoading}
              >
                <span className="truncate">
                  {isSubmitting ? "Saving…" : isEditMode ? "Save Changes" : "Save to Collection"}
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

