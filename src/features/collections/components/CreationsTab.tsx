import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Icons } from "@/design-system/icons"
import { OutfitInspirationTile, SlotRow } from "@/design-system/primitives"
import { usePrefetchCreationAssets } from "@/features/collections/hooks/usePrefetchCreationAssets"
import { useStudioProductTray } from "@/features/studio/hooks/useStudioProductTray"
import { useStudioOutfit } from "@/features/studio/hooks/useStudioOutfit"
import { useStartLikenessFlow } from "@/features/likeness/hooks/useStartLikenessFlow"
import { buildStudioUrl } from "@/features/studio/utils/studioUrlState"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackTryonFlowStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { Creation, TryOn } from "@/services/collections/collectionsService"
import type { StudioProductTraySlot } from "@/services/studio/studioService"

import { useCreations } from "../hooks/useMoodboards"

const PAGE_SIZE = 6
const SLOT_ORDER: StudioProductTraySlot[] = ["top", "bottom", "shoes"]

const resolveGender = (value?: string | null): "male" | "female" => (value === "male" ? "male" : "female")

/**
 * Collections · Creations — one look at a time.
 *
 * Ported from the bundle's `Collections · Creations` artboard: an edge-to-edge
 * figure container that takes every pixel between the tabs and the bottom card,
 * then a 170h card holding the three piece rows and the two actions. The card is
 * the same height as Studio's, so moving between the two screens does not shift
 * the ground under the figure.
 *
 * The expand disc is the artboard's control moved from the container's bottom
 * right to its top right, per the Collections spec.
 */
export function CreationsTab() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const analytics = useEngagementAnalytics()
  const startLikenessFlow = useStartLikenessFlow()

  const [currentSlide, setCurrentSlide] = useState(0)
  const [isExpanded, setIsExpanded] = useState(false)
  /**
   * Full screen only: the render is showing in place of the avatar. This is
   * what gives the tray button its third state ("view avatar") — an overlay
   * cannot have one, because it covers the tray that would carry it.
   */
  const [isRenderShowing, setIsRenderShowing] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const fullscreenTrackRef = useRef<HTMLDivElement>(null)

  const creationsQuery = useCreations(PAGE_SIZE)
  const creations = useMemo<Creation[]>(
    () => ((creationsQuery.data?.pages as Creation[][] | undefined) ?? []).flat(),
    [creationsQuery.data?.pages],
  )
  const totalSlides = creations.length
  const activeCreation = creations[currentSlide]

  const fetchNextCreationsPage = creationsQuery.fetchNextPage
  const hasMoreCreations = Boolean(creationsQuery.hasNextPage)
  const isFetchingMoreCreations = creationsQuery.isFetchingNextPage
  const shouldLoadMore =
    totalSlides > 0 && hasMoreCreations && !isFetchingMoreCreations && currentSlide >= totalSlides - 3

  const productTrayQuery = useStudioProductTray(activeCreation?.outfitId ?? null)
  const trayItems = useMemo(() => productTrayQuery.data ?? [], [productTrayQuery.data])
  const activeOutfitQuery = useStudioOutfit(activeCreation?.outfitId ?? null)
  const activeOutfit = activeOutfitQuery.data?.outfit ?? null

  // A look that already has a try-on should OPEN it, not generate another.
  // vtoImageUrl is the finished render; the status only matters while there is
  // no image yet, to say a run is in flight rather than offer a second one.
  const existingTryOn = useMemo<TryOn | null>(() => {
    if (!activeCreation?.vtoImageUrl) return null
    return {
      id: activeCreation.id,
      storagePath: null,
      status: "ready",
      createdAt: activeCreation.createdAt,
      outfitId: activeCreation.outfitId,
      imageUrl: activeCreation.vtoImageUrl,
    }
  }, [activeCreation])
  const isTryOnRunning =
    !existingTryOn &&
    (activeCreation?.latestGenerationStatus === "queued" ||
      activeCreation?.latestGenerationStatus === "generating")

  const outfitItems = useMemo(
    () => ({
      topId: trayItems.find((item) => item.slot === "top")?.productId ?? null,
      bottomId: trayItems.find((item) => item.slot === "bottom")?.productId ?? null,
      footwearId: trayItems.find((item) => item.slot === "shoes")?.productId ?? null,
    }),
    [trayItems],
  )
  const slotIds = useMemo(
    () => ({ top: outfitItems.topId, bottom: outfitItems.bottomId, shoes: outfitItems.footwearId }),
    [outfitItems.bottomId, outfitItems.footwearId, outfitItems.topId],
  )

  useEffect(() => {
    if (!shouldLoadMore) return
    void fetchNextCreationsPage()
  }, [fetchNextCreationsPage, shouldLoadMore])

  useEffect(() => {
    // The render belongs to the look you were on. Swiping to the next one
    // must drop back to the avatar, or the tray offers "view avatar" for a
    // look whose try-on does not exist.
    setIsRenderShowing(false)
  }, [activeCreation?.id])

  // Reopening full screen always starts on the avatar, never on a render
  // the user left showing minutes ago.
  useEffect(() => {
    if (!isExpanded) setIsRenderShowing(false)
  }, [isExpanded])

  // The overlay mounts at scrollLeft 0, which would read as slide 0 and snap the
  // carousel back. Jump it to the active look before it can be measured.
  useEffect(() => {
    if (!isExpanded) return
    scrollToSlide(currentSlide, "auto")
    // Only on open — following currentSlide here would fight an in-flight swipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded])

  // Escape closes the enlarged view, as a fullscreen layer should.
  useEffect(() => {
    if (!isExpanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isExpanded])

  // Every hook runs before the guards below. Returning early from between them
  // is what produced "rendered more hooks than during the previous render" on
  // this screen once already.
  usePrefetchCreationAssets({ creations, currentSlide })

  const scrollToSlide = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    // Both tracks are kept on the same index. Slides are exactly one container
    // wide, so the offset is just the index.
    for (const track of [trackRef.current, fullscreenTrackRef.current]) {
      if (!track || !track.clientWidth) continue
      const left = index * track.clientWidth
      if (Math.abs(track.scrollLeft - left) < 1) continue
      track.scrollTo({ left, behavior })
    }
  }, [])

  const goTo = useCallback(
    (index: number) => {
      if (!totalSlides) return
      // Clamp, never wrap: a wrap from the last look to the first is a smooth
      // scroll across every slide in between, churning the render window once
      // per slide on the way.
      const next = Math.max(0, Math.min(index, totalSlides - 1))
      if (next === currentSlide) return
      setCurrentSlide(next)
      scrollToSlide(next)
    },
    [currentSlide, scrollToSlide, totalSlides],
  )

  // currentSlide is committed from the track only once it has SETTLED, never
  // per scroll event. Per-event, the first half of an arrow-driven smooth scroll
  // still rounds to the slide being left, so one tap flipped the index
  // 1 → 0 → 1: each flip re-targeted the piece rows to the other outfit and
  // shifted the ±1 render window, unmounting and remounting a mannequin canvas.
  // That flicker is the "skipping" users reported.
  const settleTimerRef = useRef<number | null>(null)
  const commitSlideFromTrack = useCallback(() => {
    const track = isExpanded ? fullscreenTrackRef.current : trackRef.current
    if (!track || !track.clientWidth) return
    const index = Math.round(track.scrollLeft / track.clientWidth)
    const clamped = Math.max(0, Math.min(index, totalSlides - 1))
    setCurrentSlide((prev) => (prev === clamped ? prev : clamped))
  }, [isExpanded, totalSlides])

  // scrollend where the browser has it; a short debounce where it does not
  // (Safari before 17). Both routes land on the same commit.
  useEffect(() => {
    const track = isExpanded ? fullscreenTrackRef.current : trackRef.current
    if (!track) return
    const clearTimer = () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    const onScroll = () => {
      clearTimer()
      settleTimerRef.current = window.setTimeout(commitSlideFromTrack, 120)
    }
    const onScrollEnd = () => {
      clearTimer()
      commitSlideFromTrack()
    }
    track.addEventListener("scroll", onScroll, { passive: true })
    track.addEventListener("scrollend", onScrollEnd)
    return () => {
      clearTimer()
      track.removeEventListener("scroll", onScroll)
      track.removeEventListener("scrollend", onScrollEnd)
    }
  }, [commitSlideFromTrack, isExpanded])

  // If the list shrinks under us (a creation deleted elsewhere), keep the index
  // on a real slide rather than pointing past the end.
  useEffect(() => {
    if (totalSlides && currentSlide > totalSlides - 1) setCurrentSlide(totalSlides - 1)
  }, [currentSlide, totalSlides])

  const handleOpenStudio = useCallback(() => {
    if (!activeCreation?.outfitId) return
    navigate(buildStudioUrl("/studio", "studio", { outfitId: activeCreation.outfitId }))
  }, [activeCreation?.outfitId, navigate])

  const handleOpenAlternates = useCallback(
    (slot: StudioProductTraySlot) => {
      if (!activeCreation?.outfitId) return
      navigate(
        buildStudioUrl("/studio", "alternatives", {
          outfitId: activeCreation.outfitId,
          slotIds,
          slot,
        }),
      )
    },
    [activeCreation?.outfitId, navigate, slotIds],
  )

  const handleTryOn = useCallback(() => {
    if (!activeOutfit) {
      toast({ title: "Outfit loading", description: "Try-on is almost ready. Please try again in a moment." })
      return
    }
    trackTryonFlowStarted(analytics, {
      slotIds: { topId: outfitItems.topId, bottomId: outfitItems.bottomId, shoesId: outfitItems.footwearId },
    })
    void startLikenessFlow({
      outfitItems,
      outfitSnapshot: {
        id: activeOutfit.id,
        name: activeOutfit.name ?? null,
        category: activeOutfit.category ?? null,
        occasionId: activeOutfit.occasion?.id ?? null,
        backgroundId: activeOutfit.backgroundId ?? null,
        gender: activeOutfit.gender ?? null,
      },
    })
  }, [activeOutfit, analytics, outfitItems, startLikenessFlow, toast])

  // A three-band stack — container, card, nav — so the screen never scrolls
  // vertically.
  //
  // It is pinned rather than flexed. AppShellLayout's root is `min-h-screen`,
  // which is a minimum and not a definite height, so `flex-1` here had nothing
  // to resolve against: the container grew unbounded, pushed the card below the
  // fold, and the figure's own `h-full` collapsed to zero. Pinning to the gap
  // between the header (52h title + 36h tabs) and the nav gives the definite
  // height both of them need.
  const frameClass = cn(
    "fixed inset-x-0 mx-auto flex w-full max-w-[24.5rem] flex-col bg-background",
    "top-[calc(theme(height.control-header-title)+2.25rem)]",
    "bottom-[calc(theme(height.control-nav)+env(safe-area-inset-bottom,0px)/2)]",
  )

  if (creationsQuery.isLoading) {
    return (
      <div className={cn(frameClass, "items-center justify-center")}>
        <p className="text-body text-taupe">Loading creations…</p>
      </div>
    )
  }

  if (creationsQuery.isError) {
    return (
      <div className={cn(frameClass, "items-center justify-center px-4 text-center")}>
        <p className="text-body text-destructive">Could not load your creations.</p>
      </div>
    )
  }

  if (!totalSlides) {
    return (
      <div className={cn(frameClass, "items-center justify-center px-4 text-center")}>
        <p className="text-body text-taupe">Nothing made yet. Build a look in Studio.</p>
      </div>
    )
  }

  return (
    <>
    <div className={frameClass}>
      {/* Container — edge to edge, takes whatever the card leaves. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-y border-hairline bg-background">
        <div
          ref={trackRef}
          className="flex min-h-0 w-full flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scrollbar-hide"
        >
          {creations.map((creation, index) => (
            <div
              key={creation.id}
              className="relative h-full w-full flex-none snap-center snap-always"
              aria-hidden={index !== currentSlide}
            >
              {isRenderShowing && index === currentSlide && creation.vtoImageUrl ? (
                <img
                  src={creation.vtoImageUrl}
                  alt={`Try-on of ${creation.name}`}
                  className="h-full w-full object-contain"
                />
              ) : Math.abs(index - currentSlide) <= 1 ? (
                <OutfitInspirationTile
                  preset="heroCanonical"
                  outfitId={creation.outfitId}
                  title={creation.name}
                  chips={[]}
                  cardClassName="h-full w-full"
                  wrapperClassName="h-full w-full rounded-none bg-transparent p-0"
                  avatarHeadSrc="/avatars/Default.png"
                  avatarGender={resolveGender(creation.gender)}
                  avatarHeightCm={170}
                  disableAvatarSwipe
                />
              ) : (
                <div className="h-full w-full bg-background" />
              )}
            </div>
          ))}
        </div>

        {/* Expand — bare glyph, top right. No disc anywhere in V2. */}
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          aria-label="Expand look"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center text-ink"
        >
          <Icons.expand className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Pager — bare charcoal arrows on the side rails, dots under them.
            Swiping the track still works and drives the same state. */}
        {totalSlides > 1 ? (
          <>
            <button
              type="button"
              onClick={() => goTo(currentSlide - 1)}
              disabled={currentSlide === 0}
              aria-label="Previous look"
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink disabled:opacity-30"
            >
              <Icons.carouselPrev className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => goTo(currentSlide + 1)}
              disabled={currentSlide === totalSlides - 1}
              aria-label="Next look"
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink disabled:opacity-30"
            >
              <Icons.carouselNext className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        ) : null}
          {/* Plain dots under the chevrons — no pill. The track above stops short
              of them, so they sit on the ground, never on the figure's feet. */}
          {totalSlides > 1 ? (
            <div className="flex h-6 flex-none items-center justify-center gap-1.5" role="tablist" aria-label="Looks">
              {creations.map((creation, index) => (
                <button
                  key={creation.id}
                  type="button"
                  role="tab"
                  aria-selected={index === currentSlide}
                  aria-label={`Look ${index + 1}`}
                  onClick={() => goTo(index)}
                  className="flex h-4 w-4 items-center justify-center"
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", index === currentSlide ? "bg-charcoal" : "bg-faint")} />
                </button>
              ))}
            </div>
          ) : null}
      </div>

      {/* Card — 170h: three 32h rows over the action pair, as in the artboard. */}
      <div className="flex h-[170px] flex-none flex-col px-4 py-2.5">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex h-[100px] flex-none flex-col gap-0.5">
            {SLOT_ORDER.map((slot) => {
              const item = trayItems.find((entry) => entry.slot === slot)
              return (
                <SlotRow
                  key={slot}
                  slot={slot}
                  label={item?.title}
                  empty={!item}
                  removable={false}
                  alternatives={false}
                  onSelect={() => handleOpenAlternates(slot)}
                />
              )
            })}
          </div>

          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={handleOpenStudio}
              className="flex h-control-secondary flex-1 items-center justify-center gap-2 rounded-control border border-hairline bg-white text-label font-semibold text-ink"
            >
              <Icons.studio className="h-5 w-5" aria-hidden="true" />
              studio
            </button>
            {!existingTryOn ? (
              <button
                type="button"
                onClick={handleTryOn}
                disabled={isTryOnRunning}
                className="flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control bg-primary text-label font-semibold text-primary-foreground disabled:opacity-60"
              >
                <Icons.tryOn className="h-5 w-5" aria-hidden="true" />
                {isTryOnRunning ? "try-on running…" : "try on"}
              </button>
            ) : isRenderShowing ? (
              <button
                type="button"
                onClick={() => setIsRenderShowing(false)}
                className="flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control border border-hairline bg-white text-label font-semibold text-ink"
              >
                <Icons.viewAvatar className="h-5 w-5" aria-hidden="true" />
                view avatar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsRenderShowing(true)}
                className="flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control bg-primary text-label font-semibold text-primary-foreground"
              >
                <Icons.viewTryOn className="h-5 w-5" aria-hidden="true" />
                view try on
              </button>
            )}
          </div>
        </div>
      </div>

    </div>

    {/* Enlarge — a true fullscreen layer, so it must clear the header (z-50) and
        the nav (z-20). It sits outside the frame on purpose: the frame is fixed,
        and giving it a z-index would open a stacking context this could not
        escape. */}
    {isExpanded && activeCreation ? (
      <div className="fixed inset-0 z-[60] flex flex-col bg-background">
        {/* The look names itself in the 52px header row and nowhere else.
            V2 gives this row no button — collapse rides on the figure. */}
        <div
          className="flex h-control-header-title flex-none items-center border-b border-hairline px-4"
          style={{ paddingTop: "env(safe-area-inset-top,0px)" }}
        >
          <h1 className="min-w-0 flex-1 truncate font-display text-title font-medium text-ink">
            {activeCreation.name}
          </h1>
        </div>

        {/* Its own track, driven by the same currentSlide. Swiping here moves the
            look behind the overlay too, so closing lands on what you were seeing. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={fullscreenTrackRef}
            className="flex min-h-0 w-full flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scrollbar-hide"
          >
            {creations.map((creation, index) => (
              <div
                key={creation.id}
                className="h-full w-full flex-none snap-center snap-always"
                aria-hidden={index !== currentSlide}
              >
                {isRenderShowing && index === currentSlide && creation.vtoImageUrl ? (
                  <img
                    src={creation.vtoImageUrl}
                    alt={`Try-on of ${creation.name}`}
                    className="h-full w-full object-contain"
                  />
                ) : Math.abs(index - currentSlide) <= 1 ? (
                  <OutfitInspirationTile
                    preset="heroCanonical"
                    outfitId={creation.outfitId}
                    title={creation.name}
                    chips={[]}
                    cardClassName="h-full w-full"
                    wrapperClassName="h-full w-full rounded-none bg-transparent p-0"
                    avatarHeadSrc="/avatars/Default.png"
                    avatarGender={resolveGender(creation.gender)}
                    avatarHeightCm={170}
                    disableAvatarSwipe
                  />
                ) : (
                  <div className="h-full w-full bg-background" />
                )}
              </div>
            ))}
          </div>

          {totalSlides > 1 ? (
            <>
              {/* Bare charcoal arrows — no disc. */}
              <button
                type="button"
                onClick={() => goTo(currentSlide - 1)}
                disabled={currentSlide === 0}
                aria-label="Previous look"
                className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink disabled:opacity-30"
              >
                <Icons.carouselPrev className="h-6 w-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => goTo(currentSlide + 1)}
                disabled={currentSlide === totalSlides - 1}
                aria-label="Next look"
                className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink disabled:opacity-30"
              >
                <Icons.carouselNext className="h-6 w-6" aria-hidden="true" />
              </button>

            </>
          ) : null}
          {/* Plain dots under the chevrons — no pill. The track above stops short
              of them, so they sit on the ground, never on the figure's feet. */}
          {totalSlides > 1 ? (
            <div className="flex h-6 flex-none items-center justify-center gap-1.5" role="tablist" aria-label="Looks">
              {creations.map((creation, index) => (
                <button
                  key={creation.id}
                  type="button"
                  role="tab"
                  aria-selected={index === currentSlide}
                  aria-label={`Look ${index + 1}`}
                  onClick={() => goTo(index)}
                  className="flex h-4 w-4 items-center justify-center"
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", index === currentSlide ? "bg-charcoal" : "bg-faint")} />
                </button>
              ))}
            </div>
          ) : null}

          {/* Collapse — bare glyph, top right on the figure, the same spot
              the Creations card puts its expand control. */}
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            aria-label="Collapse look"
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center text-ink"
          >
            <Icons.collapse className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div
          className="flex flex-none items-center gap-2 px-4 pb-2.5 pt-2.5"
          style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom,0px))" }}
        >
          <button
            type="button"
            onClick={handleOpenStudio}
            className="flex h-control-secondary flex-1 items-center justify-center gap-2 rounded-control border border-hairline bg-white text-label font-semibold text-ink"
          >
            <Icons.studio className="h-5 w-5" aria-hidden="true" />
            studio
          </button>
          {/* Three states (V2 "try on button · 3 states"):
              1 · no try-on yet         → ink   · "try on"      · runs one
              2 · try-on exists, avatar → ink   · "view try on" · shows the render
              3 · render showing        → white · "view avatar" · back to the avatar */}
          {!existingTryOn ? (
            <button
              type="button"
              onClick={handleTryOn}
              disabled={isTryOnRunning}
              className="flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control bg-primary text-label font-semibold text-primary-foreground disabled:opacity-60"
            >
              <Icons.tryOn className="h-5 w-5" aria-hidden="true" />
              {isTryOnRunning ? "try-on running…" : "try on"}
            </button>
          ) : isRenderShowing ? (
            <button
              type="button"
              onClick={() => setIsRenderShowing(false)}
              className="flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control border border-hairline bg-white text-label font-semibold text-ink"
            >
              <Icons.viewAvatar className="h-5 w-5" aria-hidden="true" />
              view avatar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsRenderShowing(true)}
              className="flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control bg-primary text-label font-semibold text-primary-foreground"
            >
              <Icons.viewTryOn className="h-5 w-5" aria-hidden="true" />
              view try on
            </button>
          )}
        </div>
      </div>
    ) : null}
    </>
  )
}
