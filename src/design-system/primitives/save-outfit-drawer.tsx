import { useEffect, useMemo, useRef, useState } from "react"
import { X, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
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
}

export function SaveOutfitDrawer({
  open,
  onOpenChange,
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
}: SaveOutfitDrawerProps) {
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
              <DrawerTitle>Save outfit to collection</DrawerTitle>
              <DrawerDescription>Provide outfit details and choose moodboards.</DrawerDescription>
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
          <DrawerFooter className="px-6 pb-4 space-y-2 flex flex-row items-center gap-4">
            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            <div className="flex flex-row gap-2 w-full">
              <div className="flex gap-2 w-full">
                <Button
                  onClick={handleSave}
                  className="flex-1 bg-foreground text-background hover:bg-foreground/90 h-10 rounded-lg"
                  disabled={!isValid || isSubmitting || categoriesLoading || occasionsLoading}
                >
                  {isSubmitting ? "Saving…" : "Save to Collection"}
                </Button>

              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm whitespace-nowrap font-medium text-foreground">Private Only</span>
                <Switch
                  checked={isPrivate}
                  onCheckedChange={setIsPrivate}
                  className="scale-80"
                />
              </div>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}

