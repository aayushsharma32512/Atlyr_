import { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AppShellLayout } from "@/layouts/AppShellLayout"
import CollectionsHeader from "./components/CollectionsHeader"
import MoodboardCard, { FIGURE_FRAME_ASPECT } from "./components/MoodboardCard"
import { CreationsTab } from "./components/CreationsTab"
import { ProductsTab } from "./components/ProductsTab"

import { MoodboardPickerDrawer, OutfitInspirationTile, SectionHeader } from "@/design-system/primitives"
import { Icons } from "@/design-system/icons"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import { StudioSaveCard } from "@/features/studio/components/StudioSaveCard"
import { buildStudioUrl } from "@/features/studio/utils/studioUrlState"
import { cn } from "@/lib/utils"

import { useCollectionsOverview, useCreateMoodboard, useMoodboardItems, useProductsByIds } from "./hooks/useMoodboards"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { productDisplayImage } from "@/services/collections/collectionsService"
import { boardPath } from "./boardUrl"
import type { Moodboard } from "@/services/collections/collectionsService"

import { useToast } from "@/hooks/use-toast"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"

export function CollectionsPage() {


  // variables for search bar
  const navigate = useNavigate();
  const { toast } = useToast()

  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  // const navigate = useNavigate()
  const initialTab = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState(() =>
    initialTab === "creations" || initialTab === "products" || initialTab === "moodboards" ? initialTab : "moodboards",
  )
  const { data, isLoading } = useCollectionsOverview()
  const moodboards = useMemo(() => data?.moodboards ?? [], [data?.moodboards])
  const previews = useMemo(() => data?.previews ?? {}, [data?.previews])

  // Product cells on a board cover come from the overview RPC, which bakes only
  // image_url into its preview payload. Studio does not read that payload — it
  // queries products and picks thumbnail_url — so the covers do the same here,
  // in one batched query for every board on screen.
  const previewProductIds = useMemo(() => {
    const ids = new Set<string>()
    for (const preview of Object.values(previews)) {
      for (const item of preview?.items ?? []) {
        if (item.itemType === "product") ids.add(item.id)
      }
    }
    return [...ids].sort()
  }, [previews])

  const previewProductsQuery = useProductsByIds(previewProductIds)
  const previewProductImages = useMemo(() => {
    const rows = previewProductsQuery.data
    if (!rows) return undefined
    const out: Record<string, string | null> = {}
    for (const [id, row] of Object.entries(rows)) {
      out[id] = productDisplayImage(row.thumbnail_url, row.image_url)
    }
    return out
  }, [previewProductsQuery.data])
  const productSaveActions = useProductSaveActions()
  const createMoodboardMutation = useCreateMoodboard()

  // The strip above the grid: the looks saved most recently, newest first.
  const recentSavesQuery = useMoodboardItems("favorites", 12)
  const recentSaves = useMemo(
    () =>
      (recentSavesQuery.data?.pages ?? [])
        .flat()
        .filter((item) => item.itemType === "outfit")
        .slice(0, 12),
    [recentSavesQuery.data],
  )

  // Product pins open the Studio save card (boards only) in a drawer.
  const [productSaveId, setProductSaveId] = useState<string | null>(null)
  const saveBoards = useMemo(
    () => moodboards.filter((m) => !m.isSystem || m.slug === "favorites").map((m) => ({ slug: m.slug, label: m.label })),
    [moodboards],
  )
  const productBoardSlugs = productSaveId ? productSaveActions.getProductBoardSlugs(productSaveId) : []
  const handleSaveProduct = async (boardSlugs: string[]) => {
    if (!productSaveId) return
    try {
      await productSaveActions.onSaveToBoards(productSaveId, boardSlugs)
      setProductSaveId(null)
      toast({ title: boardSlugs.length ? "Saved" : "Removed from boards" })
    } catch {
      // onSaveToBoards has already toasted; keep the card open to retry.
    }
  }
  const { gender: profileGender, heightCm, profile } = useProfileContext()

  useEffect(() => {
    const tabParam = searchParams.get("tab")
    const nextTab =
      tabParam === "creations" || tabParam === "products" || tabParam === "moodboards" ? tabParam : "moodboards"

    if (nextTab !== activeTab) {
      setActiveTab(nextTab)
    }
  }, [activeTab, searchParams])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)

    const nextParams = new URLSearchParams(searchParams)
    if (tab === "moodboards") {
      nextParams.delete("tab")
    } else {
      nextParams.set("tab", tab)
    }

    setSearchParams(nextParams, { replace: true })
  }

  // The grid's first five cells are fixed: + New, Try-Ons, Favorites, Wardrobe,
  // then the board created most recently. Everything after that scrolls, sorted
  // by recency.
  const orderedMoodboards = useMemo(() => {
    const time = (value?: string | null) => (value ? new Date(value).getTime() : 0)
    const byRecency = (a: Moodboard, b: Moodboard) => {
      const diff = time(b.updatedAt || b.createdAt) - time(a.updatedAt || a.createdAt)
      return diff !== 0 ? diff : a.label.localeCompare(b.label)
    }

    const pinnedSlugs = ["try-ons", "favorites", "wardrobe"]
    const hidden = ["for-you", "all-outfits"]

    const pinned = pinnedSlugs
      .map((slug) => moodboards.find((m) => m.slug === slug))
      .filter((m): m is Moodboard => Boolean(m))

    const rest = moodboards
      .filter((m) => !pinnedSlugs.includes(m.slug) && !hidden.includes(m.slug))
      .sort(byRecency)

    // Slot four is the newest board by creation, which is not always the most
    // recently touched one — saving into an old board bumps its updatedAt.
    const newestIndex = rest.reduce(
      (best, board, i) => (time(board.createdAt) > time(rest[best]?.createdAt) ? i : best),
      0,
    )
    const newest = rest.splice(newestIndex, 1)

    return [...pinned, ...newest, ...rest]
  }, [moodboards])

  const handleCreateMoodboard = async (name: string) => {
    const result = await createMoodboardMutation.mutateAsync(name)
    toast({ title: "Moodboard created", description: result.label })
    return result.slug
  }

  const renderMoodboards = (boards: Moodboard[]) => {
    if (isLoading) {
      return (
        <div className="text-center text-sm text-taupe min-h-[200px] flex items-center justify-center">
          Loading moodboards…
        </div>
      )
    }
    if (!boards.length) {
      return (
        <div className="text-center text-sm text-taupe min-h-[200px] flex items-center justify-center">
          No moodboards found
        </div>
      )
    }
    return (
      <>
      {/* Recent saves — a strip of looks on the tall 112x168 card the other
          rails use. A tap opens the look in Studio. */}
      {recentSaves.length ? (
        <section className="mb-4 flex flex-col gap-2.5">
          <SectionHeader title="recent saves" />
          <div className="flex gap-2 overflow-x-auto py-0.5 scrollbar-hide">
            {recentSaves.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label="Open look in Studio"
                onClick={() => navigate(buildStudioUrl("/studio", "studio", { outfitId: item.id }))}
                // Flex, so the figure box centres; a block child inside a button did not.
                className="flex h-[168px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-hairline bg-background"
              >
                <div className="h-full" style={{ aspectRatio: FIGURE_FRAME_ASPECT }}>
                  <OutfitInspirationTile
                    preset="moodboardPreview"
                    outfitId={item.id}
                    avatarGender={item.gender ?? profileGender ?? "female"}
                    avatarHeightCm={heightCm ?? 170}
                    wrapperClassName="h-full w-full rounded-none bg-transparent p-0"
                  />
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <SectionHeader title="Boards" className="mb-2" />
      <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {/* + New leads the grid, then Try-Ons, Favorites, newest board, the rest.
            Shaped like a card — square cover plus the 40h footer — so the row lines up. */}
        <button
          type="button"
          onClick={() => setIsPickerOpen(true)}
          aria-label="New board"
          className="flex w-full flex-col overflow-hidden rounded-lg border border-dashed border-hairline-dashed text-ink transition-colors hover:bg-editorial/30"
        >
          <span className="flex aspect-square w-full items-center justify-center">
            <Icons.add className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="h-10" />
        </button>
        {boards.map((moodboard, index) => (
          <MoodboardCard
            key={`${moodboard.slug}-${moodboard.createdAt ?? moodboard.updatedAt ?? "system"}-${index}`}
            name={moodboard.label}
            slug={moodboard.slug}
            isSystem={moodboard.isSystem}
            itemCount={moodboard.itemCount}
            preview={previews[moodboard.slug]}
            productImages={previewProductImages}
            gender={profileGender}
            heightCm={heightCm}
            index={index}
          />
        ))}
      </div>
      </>
    )
  }

  const renderContent = () => {
    switch (activeTab) {
      case "moodboards":
        return renderMoodboards(orderedMoodboards)
      case "products":
        return <ProductsTab saveActions={productSaveActions} onSave={setProductSaveId} />
      default:
        return null
    }
  }

  return (
    <AppShellLayout>
      {/* 1. Real Header - Fixed at top, Visible, Interactive */}
      <CollectionsHeader
        ownerName={profile?.name ?? null}
        className="fixed top-0 left-0 right-0 z-50"
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* 2. Ghost Header - Invisible, purely for spacing */}
      {/* It sits in the document flow and pushes content down by the EXACT height of the header */}
      <CollectionsHeader
        ownerName={profile?.name ?? null}
        className="invisible pointer-events-none relative z-[-1]"
        activeTab={activeTab}
        onTabChange={() => {}}
        // userName={profile?.name ?? null}
        // creationsCount={creationsCount}
        // aria-hidden="true" // valid prop but typescript might complain if not in interface
      />

      {/* 3. Content Area - capped to the same column width as the Home feed so cards
             render at a matching size (not stretched full-width).

             Creations is the exception: its artboard is an edge-to-edge figure
             container over a fixed bottom card, so it takes the full width and
             owns its own height instead of scrolling inside this column. */}
      {activeTab === "creations" ? (
        <CreationsTab />
      ) : (
        <div className="mx-auto w-full max-w-[24.5rem] px-4 pt-2 pb-24 overflow-y-auto md:max-w-[47rem] lg:max-w-[62rem] xl:max-w-[78rem]">
          {renderContent()}
        </div>
      )}

      <MoodboardPickerDrawer
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        moodboards={moodboards}
        defaultSelection={undefined}
        // Picking an existing board here opens it, exactly as tapping its card
        // does. Before, this only closed the drawer, so the chips looked inert.
        onSelect={(slug) => {
          setIsPickerOpen(false)
          navigate(boardPath(slug))
        }}
        onCreate={handleCreateMoodboard}
        isSaving={createMoodboardMutation.isPending}
        title="Create or select a moodboard"
      />

      <Drawer open={productSaveId !== null} onOpenChange={(open) => !open && setProductSaveId(null)}>
        {/* Studio's column width, so the card and its buttons match the studio card. */}
        <DrawerContent className="mx-auto w-full max-w-sm">
          <DrawerTitle className="sr-only">Save to boards</DrawerTitle>
          <DrawerDescription className="sr-only">Pick the boards this piece is saved to.</DrawerDescription>
          {/* Block, not flex — a flex row let the card grow to the chip rail's
              full width and pushed Cancel off screen. Matches Studio's container. */}
          {productSaveId ? (
            <div className="px-4 pb-6 pt-4">
              <StudioSaveCard
                key={productSaveId}
                boards={saveBoards}
                defaultBoardSlugs={productBoardSlugs.length ? productBoardSlugs : ["favorites"]}
                isSaving={productSaveActions.isSaving}
                onSave={(data) => void handleSaveProduct(data.boardSlugs)}
                onCancel={() => setProductSaveId(null)}
                onCreateBoard={(name) => createMoodboardMutation.mutateAsync(name).then((res) => res.slug)}
              />
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>
    </AppShellLayout>
  )
}
