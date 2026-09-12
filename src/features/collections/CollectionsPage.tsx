import { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AppShellLayout } from "@/layouts/AppShellLayout"
import CollectionsHeader from "./components/CollectionsHeader"
import MoodboardCard from "./components/MoodboardCard"
import { CreationsTab } from "./components/CreationsTab"
import { ProductsTab } from "./components/ProductsTab"

import { MoodboardPickerDrawer, SectionHeader } from "@/design-system/primitives"
import { Icons } from "@/design-system/icons"

import { useCollectionsOverview, useCreateMoodboard, useProductsByIds } from "./hooks/useMoodboards"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { productDisplayImage } from "@/services/collections/collectionsService"
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
  const { gender: profileGender, heightCm } = useProfileContext()

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

  // The grid's first four cells are fixed: + New, Try-Ons, Favorites, then the
  // board created most recently. Everything after that scrolls, sorted by
  // recency.
  const orderedMoodboards = useMemo(() => {
    const time = (value?: string | null) => (value ? new Date(value).getTime() : 0)
    const byRecency = (a: Moodboard, b: Moodboard) => {
      const diff = time(b.updatedAt || b.createdAt) - time(a.updatedAt || a.createdAt)
      return diff !== 0 ? diff : a.label.localeCompare(b.label)
    }

    const pinnedSlugs = ["try-ons", "favorites"]
    // wardrobe is dropped at the service boundary too, but a cached overview
    // payload from before that change still carries the row — this keeps it
    // off the grid regardless of where the list came from.
    const hidden = ["wardrobe", "for-you", "all-outfits"]

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
        return <ProductsTab saveActions={productSaveActions} />
      default:
        return null
    }
  }

  return (
    <AppShellLayout>
      {/* 1. Real Header - Fixed at top, Visible, Interactive */}
      <CollectionsHeader
        className="fixed top-0 left-0 right-0 z-50"
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* 2. Ghost Header - Invisible, purely for spacing */}
      {/* It sits in the document flow and pushes content down by the EXACT height of the header */}
      <CollectionsHeader
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
          navigate(`/home?${new URLSearchParams({ moodboard: slug }).toString()}`)
        }}
        onCreate={handleCreateMoodboard}
        isSaving={createMoodboardMutation.isPending}
        title="Create or select a moodboard"
      />

      <MoodboardPickerDrawer
        open={productSaveActions.isPickerOpen}
        onOpenChange={(open) => {
          if (!open) {
            productSaveActions.closePicker()
          }
        }}
        moodboards={productSaveActions.moodboards}
        mode="multi"
        onSelect={() => { }}
        onApply={productSaveActions.onApplyMoodboards}
        onCreate={productSaveActions.onCreateMoodboard}
        isSaving={productSaveActions.isSaving}
        title="Add to moodboard"
      />
    </AppShellLayout>
  )
}
