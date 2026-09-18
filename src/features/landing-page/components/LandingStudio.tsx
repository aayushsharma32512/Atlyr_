import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react"
import { Assets } from "pixi.js"
import { Icons } from "@/design-system/icons"
import { OutfitInspirationTile, WordmarkLockup } from "@/design-system/primitives"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { AlternatesSourceTabs } from "@/features/studio/components/AlternatesHeader"
import { AlternatesRack } from "@/features/studio/components/AlternatesRack"
import { AlternatesSearchBar } from "@/features/studio/components/AlternatesSearchDock"
import { SlotIconRow } from "@/features/studio/components/SlotIconRow"
import { StudioCanvas } from "@/features/studio/components/StudioCanvas"
import { isDressTop } from "@/features/studio/hooks/usePlaceholderItems"
import { mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import { toTrayItem } from "@/features/studio/utils/trayMutations"
import { uploadSearchImage } from "@/services/storage/publicFilesService"
import { downscaleImage } from "@/utils/downscaleImage"
import type { StudioSource } from "@/features/studio/utils/studioUrlState"
import type { StudioRenderedItem } from "@/features/studio/types"
import type { StudioAlternativeProduct, StudioProductTraySlot } from "@/services/studio/studioService"
import { LANDING_BOTTOMS, LANDING_LOOKS, LANDING_SHOES, LANDING_TOPS } from "../landingInventory"
import { withBundledGarment } from "../landingLookAssets"
import { useLandingFirstLook, useLandingInventory, useLandingSearch } from "../hooks/useLandingStudioData"
import { scrollToWaitlist } from "../scrollToWaitlist"

const SLOTS: StudioProductTraySlot[] = ["top", "bottom", "shoes"]
const SEARCH_USED_KEY = "atlyr_landing_search_used_v1"
const SWIPE_MIN_PX = 40

type Look = Record<StudioProductTraySlot, StudioAlternativeProduct | null>
type Committed = { text: string; imageUrl: string | null }

function readSearchUsed(): boolean {
  try {
    return localStorage.getItem(SEARCH_USED_KEY) === "1"
  } catch {
    return false
  }
}

function markSearchUsed() {
  try {
    localStorage.setItem(SEARCH_USED_KEY, "1")
  } catch {
    // Private mode: the visitor gets another search, nothing else breaks.
  }
}

const NUDGE = "flex h-8 w-8 flex-none items-center justify-center text-ink"
const CHEVRON = "absolute top-1/2 z-[2] flex h-11 w-11 -translate-y-1/2 items-center justify-center text-violet"

/** Full-res cut-outs already requested; the renderer fetches the same URL the same way and hits the cache. */
const warmedFullRes = new Set<string>()

function warmFullRes(url: string | undefined) {
  if (!url || warmedFullRes.has(url)) return
  warmedFullRes.add(url)
  fetch(url, { mode: "cors" })
    .then((res) => res.blob())
    .catch(() => warmedFullRes.delete(url))
}

function thumbnailOf(product: StudioAlternativeProduct | null | undefined): string | null {
  return product?.imageSrc && product.imageSrc !== product.imageUrl ? product.imageSrc : null
}

/**
 * The studio demo on the landing page: the in-app alternates screen, composed from
 * its own parts, over a fixed women's catalogue. Nothing here writes to the server.
 */
export function LandingStudio() {
  const { toast } = useToast()
  const firstLook = useLandingFirstLook()
  const inventory = useLandingInventory()

  const byId = useMemo(
    () => new Map([...(firstLook.data ?? []), ...(inventory.data ?? [])].map((product) => [product.id, product])),
    [firstLook.data, inventory.data],
  )
  const curatedLooks = useMemo<Look[]>(
    () =>
      LANDING_LOOKS.map(([topIndex, bottomIndex]) => ({
        top: withBundledGarment(byId.get(LANDING_TOPS[topIndex].id) ?? null),
        bottom: withBundledGarment(byId.get(LANDING_BOTTOMS[bottomIndex].id) ?? null),
        shoes: withBundledGarment(byId.get(LANDING_SHOES.id) ?? null),
      })),
    [byId],
  )

  const [lookIndex, setLookIndex] = useState(0)
  // Pieces worn over a curated look, kept per look so stepping away and back keeps them.
  const [worn, setWorn] = useState<Record<number, Partial<Look>>>({})
  const [isRackOpen, setIsRackOpen] = useState(false)
  const [slot, setSlot] = useState<StudioProductTraySlot>("top")
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [draft, setDraft] = useState("")
  // The photo shows in the bar at once from a local URL while its upload runs; submit awaits the upload.
  const [draftThumb, setDraftThumb] = useState<string | null>(null)
  const pendingUpload = useRef<Promise<string> | null>(null)
  const [isAwaitingUpload, setIsAwaitingUpload] = useState(false)
  const [committed, setCommitted] = useState<Partial<Record<StudioProductTraySlot, Committed>>>({})
  // The figure stays hidden until its first composite: a bare mannequin must never show.
  const [hasRendered, setHasRendered] = useState(false)

  const look: Look = { ...curatedLooks[lookIndex], ...worn[lookIndex] }
  const { top, bottom, shoes } = look

  const renderedItems = useMemo(() => {
    const pieces: Look = { top, bottom, shoes }
    const trayItems = SLOTS.flatMap((s) => (pieces[s] ? [toTrayItem(s, pieces[s]!)] : []))
    const topIsDress = isDressTop(trayItems, false)
    return trayItems
      .filter((item) => !(topIsDress && item.slot === "bottom"))
      .map(mapTrayItemToStudioRenderedItem)
      .filter((item): item is StudioRenderedItem => Boolean(item))
  }, [top, bottom, shoes])

  const active = committed[slot] ?? { text: "", imageUrl: null }
  const hasSearch = Boolean(active.text || active.imageUrl)
  const search = useLandingSearch(slot, active.text, active.imageUrl)
  const rackProducts = useMemo(
    () => (hasSearch ? (search.data ?? []) : (inventory.data ?? []).filter((product) => product.itemType === slot)),
    [hasSearch, inventory.data, search.data, slot],
  )
  const isRackLoading = isAwaitingUpload || (hasSearch ? search.isLoading : inventory.isLoading)

  // Every look's thumbnails go into PIXI's own cache, so a step composites at once and only the
  // full-res upgrade streams in behind it, as in the app.
  useEffect(() => {
    if (!inventory.data) return
    const urls = curatedLooks.flatMap((l) => SLOTS.flatMap((s) => thumbnailOf(l[s]) ?? []))
    void Assets.backgroundLoad([...new Set(urls)])
  }, [curatedLooks, inventory.data])

  // The rack's tiles are wearable, so their thumbnails follow the same route once a slot is open.
  useEffect(() => {
    if (!isRackOpen) return
    void Assets.backgroundLoad(rackProducts.flatMap((p) => thumbnailOf(p) ?? []))
  }, [isRackOpen, rackProducts])

  // Only after the current look is on screen: every look's garment, so each chevron step is instant.
  useEffect(() => {
    if (!hasRendered) return
    for (const look of curatedLooks) for (const s of SLOTS) warmFullRes(look[s]?.imageUrl)
  }, [curatedLooks, hasRendered])

  const stepLook = (delta: number) => {
    const count = curatedLooks.length
    if (count) setLookIndex((index) => (index + delta + count) % count)
  }

  const wear = (product: StudioAlternativeProduct) => {
    setWorn((prev) => ({ ...prev, [lookIndex]: { ...prev[lookIndex], [slot]: product } }))
  }

  const closeRack = () => {
    setIsSearchOpen(false)
    setIsRackOpen(false)
  }

  const handleSourceChange = (source: StudioSource) => {
    if (source === "explore") return
    toast({ title: source === "wardrobe" ? "Join Atlyr to add your wardrobe" : "Join Atlyr to save items" })
    scrollToWaitlist()
  }

  const openSearch = () => {
    if (readSearchUsed()) {
      toast({ title: "Explore vibe search on Atlyr", description: "Join the waitlist to search the whole catalogue." })
      scrollToWaitlist()
      return
    }
    setIsRackOpen(true)
    setIsSearchOpen(true)
  }

  const clearDraftImage = () => {
    if (draftThumb) URL.revokeObjectURL(draftThumb)
    setDraftThumb(null)
    pendingUpload.current = null
  }

  const handlePickImage = (file: File) => {
    clearDraftImage()
    setDraftThumb(URL.createObjectURL(file))
    const upload = downscaleImage(file).then((small) => uploadSearchImage({ file: small }))
    upload.catch(() => {
      toast({ title: "That photo could not be used", description: "Try another one." })
      clearDraftImage()
    })
    pendingUpload.current = upload
  }

  const submitSearch = async () => {
    const text = draft.trim()
    const upload = pendingUpload.current
    if (!text && !upload) return
    markSearchUsed()
    setIsAwaitingUpload(Boolean(upload))
    const imageUrl = upload ? await upload.catch(() => null) : null
    setIsAwaitingUpload(false)
    if (!text && !imageUrl) return
    setDraft("")
    clearDraftImage()
    setCommitted((prev) => ({ ...prev, [slot]: { text, imageUrl } }))
  }

  const clearQuery = () => setCommitted((prev) => ({ ...prev, [slot]: { text: "", imageUrl: null } }))

  // A horizontal swipe on the figure steps the look; a tap toggles the rack.
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)

  const handleTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
    swiped.current = false
  }

  const handleTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start || isRackOpen) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true
      stepLook(dx < 0 ? 1 : -1)
    }
  }

  const handleFigureClick = () => {
    if (swiped.current) {
      swiped.current = false
      return
    }
    setIsSearchOpen(false)
    setIsRackOpen((open) => !open)
  }

  const figure = (
    <div
      className={cn(
        "absolute inset-0 flex items-end justify-center pb-3 transition-opacity duration-300",
        hasRendered ? "opacity-100" : "opacity-0",
      )}
    >
      {renderedItems.length > 0 ? (
        <OutfitInspirationTile
          preset="heroCanonical"
          outfitId={`landing-look-${lookIndex}`}
          renderedItems={renderedItems}
          title=""
          chips={[]}
          isSaved={false}
          avatarGender="female"
          avatarHeightCm={170}
          cardClassName="h-full w-full"
          disableAvatarSwipe
          onAvatarReady={(ready) => {
            if (ready) setHasRendered(true)
          }}
        />
      ) : null}
    </div>
  )

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[430px] flex-col overflow-hidden rounded-[34px] bg-background">
      {/* The 52px header row of the in-app alternates screen, with the mark where "Back" sits. */}
      <div className="box-border flex h-[52px] flex-none items-center pl-4">
        <div className="flex min-w-0 flex-1 items-center">
          <WordmarkLockup size="landingHeader" />
        </div>
        {/* Exactly the rack's half, so its icons line up over the slot row and the X keeps the grid icon's spot. */}
        <div className="flex h-full w-1/2 flex-none items-center justify-end pr-2">
          {isRackOpen ? (
            <>
              <AlternatesSourceTabs
                source="explore"
                onSourceChange={handleSourceChange}
                className="h-full w-auto flex-1 px-1"
              />
              <button type="button" aria-label="Close alternates" onClick={closeRack} className={NUDGE}>
                <Icons.close className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button type="button" aria-label="Open alternates" onClick={() => setIsRackOpen(true)} className={NUDGE}>
              <Icons.alternatives className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div
          className={cn(
            "relative flex min-h-0 touch-pan-y",
            isRackOpen ? "w-1/2 flex-none" : "w-full",
          )}
          onClick={handleFigureClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <StudioCanvas compact={isRackOpen} focus={null} figure={figure} />
          {!isRackOpen && curatedLooks.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous look"
                onClick={(event) => {
                  event.stopPropagation()
                  stepLook(-1)
                }}
                className={cn(CHEVRON, "left-2")}
              >
                <Icons.carouselPrev className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next look"
                onClick={(event) => {
                  event.stopPropagation()
                  stepLook(1)
                }}
                className={cn(CHEVRON, "right-2")}
              >
                <Icons.carouselNext className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>

        {isRackOpen ? (
          <div className="relative flex w-1/2 min-w-0 flex-none flex-col bg-muted/20">
            <SlotIconRow
              slots={SLOTS}
              active={slot}
              onSelect={(next) => {
                if (next !== "layer") setSlot(next)
              }}
              className="border-b-0"
            />
            <AlternatesRack
              products={rackProducts}
              isLoading={isRackLoading}
              wornProductId={look[slot]?.id ?? null}
              queryLine={active.text ? `“${active.text}”` : active.imageUrl ? "like your photo" : null}
              onClearQuery={clearQuery}
              onSelect={wear}
              emptyLabel="Nothing found for that"
              framedTiles={false}
            />
          </div>
        ) : null}

        {isSearchOpen ? (
          <AlternatesSearchBar
            value={draft}
            onValueChange={setDraft}
            onSubmit={() => void submitSearch()}
            onClose={() => setIsSearchOpen(false)}
            onClear={() => setDraft("")}
            placeholder={`Search ${slot === "shoes" ? "shoes" : `${slot}s`} by vibe`}
            thumbSrc={draftThumb}
            onClearThumb={clearDraftImage}
            onPickImage={handlePickImage}
          />
        ) : (
          <button
            type="button"
            aria-label="Search by vibe"
            onClick={openSearch}
            className="absolute bottom-3 left-3 z-[2] flex h-control-field w-control-field items-center justify-center rounded-control bg-ink text-background shadow-md"
          >
            <Icons.search className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
