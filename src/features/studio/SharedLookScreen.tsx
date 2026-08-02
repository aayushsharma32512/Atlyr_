import { useMemo, useState } from "react"
import { ChevronLeft, LoaderCircle } from "lucide-react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { PriceDisplay } from "@/design-system/primitives/price-display"
import { OutfitInspirationTile } from "@/design-system/primitives/outfit-inspiration-tile"
import { useAuth } from "@/contexts/AuthContext"
import { useGuest } from "@/contexts/GuestContext"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useStudioOutfit } from "@/features/studio/hooks/useStudioOutfit"
import { useStudioProductTray } from "@/features/studio/hooks/useStudioProductTray"
import { useStudioResolvedSlots } from "@/features/studio/hooks/useStudioResolvedSlots"
import { mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import { buildStudioUrl, parseStudioSearchParams } from "@/features/studio/utils/studioUrlState"
import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"

const SLOT_LABELS: Record<StudioProductTraySlot, string> = {
  top: "Topwear",
  bottom: "Bottomwear",
  shoes: "Footwear",
}

const SLOT_ORDER: StudioProductTraySlot[] = ["top", "bottom", "shoes"]

function displayLookName(name?: string | null) {
  if (!name || name.startsWith("draft-look-")) return "A look shared with you"
  return name
}

function SharedLookHeading({ name, className = "" }: { name?: string | null; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Shared with you
      </p>
      <h1 className="mt-2 font-display text-[30px] font-medium leading-none tracking-[-0.02em] text-foreground sm:text-[34px]">
        {displayLookName(name)}
      </h1>
    </div>
  )
}

function SharedProductRow({ item }: { item: StudioProductTrayItem }) {
  return (
    <div className="flex min-h-16 min-w-0 items-center gap-2.5 border-b border-hairline px-3 py-3 last:border-b-0 sm:gap-3 sm:px-4 lg:min-h-14 lg:py-2.5">
      <span className="w-16 shrink-0 text-sm font-semibold text-foreground sm:w-[4.5rem]">
        {SLOT_LABELS[item.slot]}
      </span>
      <span className="min-w-0 flex-1 text-right">
        <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
        {item.brand ? (
          <span className="block truncate text-xs text-muted-foreground">{item.brand}</span>
        ) : null}
      </span>
      <PriceDisplay
        price={item.price}
        formatOptions={{ currency: item.currency || "INR" }}
        className="shrink-0 text-sm"
      />
    </div>
  )
}

export function SharedLookScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { guestState } = useGuest()
  const { profile } = useProfileContext()
  const createDraftOutfit = useCreateDraftOutfit()
  const [remixError, setRemixError] = useState<string | null>(null)

  const parsedParams = useMemo(() => parseStudioSearchParams(searchParams), [searchParams])
  const outfitQuery = useStudioOutfit(parsedParams.outfitId)
  const trayQuery = useStudioProductTray(parsedParams.outfitId)
  const baseTrayItems = outfitQuery.data?.trayItems?.length
    ? outfitQuery.data.trayItems
    : (trayQuery.data ?? [])
  const resolvedSlots = useStudioResolvedSlots({
    outfitId: parsedParams.outfitId,
    baseOutfitItems: baseTrayItems,
    requestedSlotIds: parsedParams.slotIds,
  })

  const hiddenSlots = useMemo(
    () => parsedParams.hiddenSlots ?? {},
    [parsedParams.hiddenSlots],
  )
  const visibleItems = useMemo(
    () =>
      SLOT_ORDER.flatMap((slot) => {
        if (hiddenSlots[slot]) return []
        const item = resolvedSlots.trayItems.find((candidate) => candidate.slot === slot)
        return item ? [item] : []
      }),
    [hiddenSlots, resolvedSlots.trayItems],
  )
  const renderedItems = useMemo(
    () =>
      visibleItems
        .map((item) => mapTrayItemToStudioRenderedItem(item))
        .filter((item): item is NonNullable<typeof item> => item !== null),
    [visibleItems],
  )

  const outfit = outfitQuery.data?.outfit ?? null
  const isAuthenticated = Boolean(user) && !guestState.isGuest
  const isLoading = outfitQuery.isLoading || trayQuery.isLoading || resolvedSlots.isResolving
  const isUnavailable = !isLoading && visibleItems.length === 0
  const lookTotal = visibleItems.reduce((total, item) => total + item.price, 0)
  const currency = visibleItems[0]?.currency ?? "INR"
  const loginDestination = `/auth/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`

  const handleRemix = async () => {
    if (!user?.id || guestState.isGuest || visibleItems.length === 0) return

    setRemixError(null)
    const itemsBySlot = new Map(visibleItems.map((item) => [item.slot, item]))
    try {
      const draft = await createDraftOutfit.mutateAsync({
        userId: user.id,
        topId: itemsBySlot.get("top")?.productId ?? null,
        bottomId: itemsBySlot.get("bottom")?.productId ?? null,
        shoesId: itemsBySlot.get("shoes")?.productId ?? null,
        gender: outfit?.gender ?? outfitQuery.data?.avatarGender ?? null,
        backgroundId: outfit?.backgroundId ?? null,
        createdByName: profile?.name ?? null,
      })
      navigate(buildStudioUrl("/studio", "studio", { outfitId: draft.id }))
    } catch (error) {
      console.error("Failed to create an editable copy of shared outfit", error)
      setRemixError("We couldn't open this look in your Studio. Please try again.")
    }
  }

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-background text-foreground lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-[max(1.5rem,env(safe-area-inset-top))] lg:flex lg:h-full lg:max-w-6xl lg:flex-col lg:px-8 lg:pb-6">
        <header className="grid shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center">
          <button
            type="button"
            onClick={() => navigate(isAuthenticated ? "/home?moodboard=for-you" : "/")}
            className="flex size-11 items-center justify-start rounded-md text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={isAuthenticated ? "Back to home" : "Back to Atlyr"}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
            Shared look
          </p>
          <span aria-hidden="true" />
        </header>

        <SharedLookHeading name={outfit?.name} className="mt-4 lg:hidden" />

        <main className="min-w-0 lg:mt-4 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)] lg:gap-6">
          <section
            className="mt-4 min-w-0 overflow-hidden rounded-lg border border-hairline bg-card shadow-xs lg:mt-0 lg:h-full lg:min-h-0"
            aria-label="Shared outfit preview"
          >
            <div className="relative aspect-[4/5] max-h-[31rem] w-full overflow-hidden bg-muted/20 lg:h-full lg:max-h-none lg:aspect-auto">
              {isLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Loading look…
                </div>
              ) : isUnavailable ? (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                  <p className="text-base font-semibold text-foreground">This look is unavailable</p>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">
                    Its products may have been removed or the link may be incomplete.
                  </p>
                </div>
              ) : (
                <OutfitInspirationTile
                  preset="heroCanonical"
                  outfitId={outfit?.id ?? parsedParams.outfitId ?? "shared-look"}
                  renderedItems={renderedItems}
                  fallbackImageSrc={renderedItems[0]?.imageUrl}
                  title={displayLookName(outfit?.name)}
                  chips={[outfit?.fit, outfit?.feel].filter((value): value is string => Boolean(value))}
                  isSaved={false}
                  avatarHeadSrc={outfitQuery.data?.avatarHeadSrc}
                  avatarGender={outfitQuery.data?.avatarGender ?? "female"}
                  avatarHeightCm={170}
                  cardClassName="h-full w-full"
                />
              )}
            </div>
          </section>

          <div className="min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:justify-center">
            <SharedLookHeading name={outfit?.name} className="hidden lg:block" />

            {visibleItems.length > 0 ? (
              <section
                className="mt-4 min-w-0 overflow-hidden rounded-lg border border-hairline bg-card shadow-xs"
                aria-label="Pieces in this look"
              >
                {visibleItems.map((item) => (
                  <SharedProductRow key={item.slot} item={item} />
                ))}
                <div className="flex min-h-12 items-center justify-between gap-4 bg-muted/15 px-4 py-2.5">
                  <span className="text-sm font-semibold text-foreground">
                    {visibleItems.length} {visibleItems.length === 1 ? "piece" : "pieces"}
                  </span>
                  <PriceDisplay
                    price={lookTotal}
                    formatOptions={{ currency }}
                    className="text-base font-bold"
                  />
                </div>
              </section>
            ) : null}

            <section className="mt-4 min-w-0 rounded-lg border border-hairline bg-card p-4 shadow-xs sm:p-5 lg:p-4">
              <h2 className="text-lg font-semibold text-foreground">Make it yours</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {isAuthenticated
                  ? "Create a private, editable copy of this look in your Studio."
                  : "Log in to remix this look, try it on and save it to your boards."}
              </p>

              {isAuthenticated ? (
                <Button
                  type="button"
                  onClick={handleRemix}
                  disabled={isUnavailable || createDraftOutfit.isPending}
                  className="mt-3 h-11 w-full rounded-md"
                >
                  {createDraftOutfit.isPending ? (
                    <>
                      <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      Creating your copy…
                    </>
                  ) : (
                    "Remix in my Studio"
                  )}
                </Button>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2">
                  <Link
                    to="/?waitlist=1"
                    className="inline-flex h-11 min-w-0 items-center justify-center rounded-md border border-hairline-3 px-3 text-center text-sm font-semibold text-foreground hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Join waitlist
                  </Link>
                  <Link
                    to={loginDestination}
                    className="inline-flex h-11 min-w-0 items-center justify-center rounded-md bg-primary px-3 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Log in to remix
                  </Link>
                </div>
              )}

              {remixError ? (
                <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                  {remixError}
                </p>
              ) : null}
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}

export default SharedLookScreen
