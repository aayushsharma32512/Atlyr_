import { useMemo, useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { AppShellLayout } from "@/layouts/AppShellLayout"
import CollectionsHeader from "./components/CollectionsHeader"
import MoodboardCard from "./components/MoodboardCard"
import { CreationsTab } from "./components/CreationsTab"

import {
  FilterSearchBar,
  type FilterSearchBarChip,
  MoodboardPickerDrawer,
  ProductResultsGrid,
} from "@/design-system/primitives"


import { useCollectionsOverview, useCreateMoodboard, useCreationsCounts, useDeleteMoodboard, useSavedProducts } from "./hooks/useMoodboards"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import type { Moodboard } from "@/services/collections/collectionsService"

import { useToast } from "@/hooks/use-toast"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useSearchImageUpload } from "@/features/search/hooks/useSearchImageUpload"

export function CollectionsPage() {


  // variables for search bar
  const navigate = useNavigate();
  const { toast } = useToast()

  // Search state - matching HomeScreen implementation
  const [searchTerm, setSearchTerm] = useState("")
  const [activeFilter, setActiveFilter] = useState<"products" | "outfits">("outfits")
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | undefined>(undefined)
  const searchImageUpload = useSearchImageUpload()
  const isUploading = searchImageUpload.isPending

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value)
  }, [])

  const handleImageUpload = useCallback(async (file: File) => {
    try {
      const publicUrl = await searchImageUpload.mutateAsync(file)

      setUploadedImageUrl(publicUrl)
      setActiveFilter("products")
    } catch (error) {
      console.error("Image upload failed:", error)
      toast({ title: "Upload failed", description: "Could not upload image", variant: "destructive" })
    }
  }, [searchImageUpload, toast])

  const handleClearImage = useCallback(() => {
    setUploadedImageUrl(undefined)
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = searchTerm.trim()
    if (trimmed.length === 0 && !uploadedImageUrl) {
      return
    }

    // Navigate to /search route with query params - same as HomeScreen
    const params = new URLSearchParams()
    if (trimmed.length > 0) {
      params.set("search", trimmed)
    }
    if (uploadedImageUrl) {
      params.set("imageUrl", encodeURIComponent(uploadedImageUrl))
    }
    params.set("mode", activeFilter)
    navigate(`/search?${params.toString()}`)
  }, [activeFilter, navigate, searchTerm, uploadedImageUrl])

  const handleClear = useCallback(() => {
    setSearchTerm("")
  }, [])

  const handleFilterChange = useCallback((next: "products" | "outfits") => {
    setActiveFilter(next)
  }, [])

  const handleFilterToggle = useCallback(() => {
    const next = activeFilter === "products" ? "outfits" : "products"
    handleFilterChange(next)
  }, [activeFilter, handleFilterChange])

  // Track when search bar is focused - same as HomeScreen
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  // Determine if filters should be visible - same logic as HomeScreen
  const shouldShowFilters = isSearchFocused || uploadedImageUrl || searchTerm.trim().length > 0

  const filterChips: FilterSearchBarChip[] = [
    {
      id: "products",
      label: "Products",
      isActive: activeFilter === "products",
      onActivate: () => handleFilterChange("products"),
      onDeactivate: () => handleFilterToggle(),
    },
    {
      id: "outfits",
      label: "Outfits",
      isActive: activeFilter === "outfits",
      onActivate: () => handleFilterChange("outfits"),
      onDeactivate: () => handleFilterToggle(),
    },
  ]

  //search bar variables end here 
  const columns = useResponsiveColumns()
  const [searchQuery, setSearchQuery] = useState("")
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  // const navigate = useNavigate()
  const initialTab = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState(() =>
    initialTab === "creations" || initialTab === "products" || initialTab === "moodboards" ? initialTab : "moodboards",
  )
  const [moodboardSort, setMoodboardSort] = useState<"recency" | "alphabetical">("recency")
  const { data, isLoading } = useCollectionsOverview()
  const creationsCountsQuery = useCreationsCounts()
  const moodboards = data?.moodboards ?? []
  const previews = data?.previews ?? {}
  const savedProductsQuery = useSavedProducts()
  const productSaveActions = useProductSaveActions()
  const createMoodboardMutation = useCreateMoodboard()
  const deleteMoodboardMutation = useDeleteMoodboard()
  const { profile } = useProfileContext()
  const creationsCount = creationsCountsQuery.data?.totalCount ?? 0

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

  const filteredMoodboards = useMemo(() => {
    // Start with all moodboards
    let result = moodboards

    // Apply search filter
    if (searchQuery.trim()) {
      const term = searchQuery.toLowerCase()
      result = result.filter((board) => board.label.toLowerCase().includes(term))
    }

    // Separate system and user moodboards (system stays at top)
    const systemBoards = result.filter((m) => m.isSystem)
    const userBoards = result.filter((m) => !m.isSystem)

    // Sort user moodboards based on sortValue
    if (moodboardSort === "alphabetical") {
      // A-Z sorting
      userBoards.sort((a, b) => a.label.localeCompare(b.label))
    } else {
      // Recency: Sort by updated (or created) time, newest first
      userBoards.sort((a, b) => {
        const timeA = a.updatedAt || a.createdAt
        const timeB = b.updatedAt || b.createdAt

        if (timeA && timeB) {
          return new Date(timeB).getTime() - new Date(timeA).getTime()
        }
        // Items with time come before items without
        if (timeA) return -1
        if (timeB) return 1

        // Fallback to Z-A (reverse alphabetical) if no dates, so it's distinct from A-Z
        return b.label.localeCompare(a.label)
      })
    }

    return [...systemBoards, ...userBoards]
  }, [moodboards, searchQuery, moodboardSort])

  const handleCreateMoodboard = async (name: string) => {
    const result = await createMoodboardMutation.mutateAsync(name)
    toast({ title: "Moodboard created", description: result.label })
    return result.slug
  }

  const handleDeleteMoodboard = async (slug: string, name: string) => {
    try {
      await deleteMoodboardMutation.mutateAsync(slug)
      toast({ title: "Moodboard deleted", description: name })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete moodboard"
      toast({ title: "Delete failed", description: message, variant: "destructive" })
    }
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {boards.map((moodboard, index) => (
          <MoodboardCard
            key={`${moodboard.slug}-${moodboard.createdAt ?? moodboard.updatedAt ?? "system"}-${index}`}
            name={moodboard.label}
            slug={moodboard.slug}
            isSystem={moodboard.isSystem}
            itemCount={moodboard.itemCount}
            preview={previews[moodboard.slug]}
            onDelete={handleDeleteMoodboard}
            index={index}
          />
        ))}
        {/* Canvas 6e: the "+ New board" tile closes the board list. */}
        <button
          type="button"
          onClick={() => setIsPickerOpen(true)}
          className="flex min-h-[150px] items-center justify-center rounded-frame border border-dashed border-hairline-dashed px-4 text-center text-[11.5px] font-medium text-taupe transition-colors hover:bg-editorial/30"
        >
          ＋ New board — long-press anything, it sticks here
        </button>
      </div>
    )
  }

  const productItems = useMemo(() => {
    const products = savedProductsQuery.data ?? []
    return products.map((product) => {
      const saved = productSaveActions.isSaved(product.id)
      const priceLabel =
        typeof product.price === "number"
          ? new Intl.NumberFormat("en-IN", { style: "currency", currency: product.currency ?? "INR" }).format(
            product.price,
          )
          : "—"
      return {
        id: product.id,
        imageSrc: product.imageUrl ?? "",
        title: product.productName ?? "Saved product",
        brand: product.brand ?? "Brand",
        price: priceLabel,
        isSaved: saved,
        onToggleSave: () => productSaveActions.onToggleSave(product.id, !saved),
        onLongPressSave: () => productSaveActions.onLongPressSave(product.id),
      }
    })
  }, [productSaveActions, savedProductsQuery.data])

  const originPath = useMemo(
    () => `${location.pathname}${location.search}` || "/collection",
    [location.pathname, location.search],
  )

  const handleProductSelect = (productId: string) => {
    const params = new URLSearchParams()
    params.set("returnTo", encodeURIComponent(originPath))
    const search = params.toString()
    navigate(`/studio/product/${encodeURIComponent(productId)}${search ? `?${search}` : ""}`)
  }

  const renderContent = () => {
    switch (activeTab) {
      case "moodboards":
        return renderMoodboards(filteredMoodboards)
      case "creations":
        return <CreationsTab />
      case "products":
        if (savedProductsQuery.isLoading) {
          return (
            <div className="text-center text-sm text-taupe min-h-[200px] flex items-center justify-center">
              Loading saved products…
            </div>
          )
        }
        if (savedProductsQuery.isError) {
          return (
            <div className="text-center text-sm text-taupe min-h-[200px] flex items-center justify-center">
              Unable to load products right now.
            </div>
          )
        }
        if (productItems.length === 0) {
          return (
            <div className="text-center text-sm text-taupe min-h-[200px] flex items-center justify-center">
              No saved products yet.
            </div>
          )
        }
        return (
          <ProductResultsGrid
            items={productItems}
            columns={columns}
            rows={8}
            onItemSelect={(item) => handleProductSelect(item.id)}
          />
        )
      default:
        return null
    }
  }

  return (
    <AppShellLayout>
      {/* 1. Real Header - Fixed at top, Visible, Interactive */}
      <CollectionsHeader
        className="fixed top-0 left-0 right-0 z-50 border-b border-border/30"
        onAddMoodboard={() => setIsPickerOpen(true)}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        userName={profile?.name ?? null}
        creationsCount={creationsCount}
        sortValue={moodboardSort}
        onSortChange={(v) => setMoodboardSort(v as "recency" | "alphabetical")}
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
             render at a matching size (not stretched full-width). */}
      <div className="mx-auto w-full max-w-[24.5rem] px-4 pt-2 pb-24 overflow-y-auto md:max-w-[47rem] lg:max-w-[62rem] xl:max-w-[78rem]">
        {/* Search bar on top, the Moodboards/Creations/Products toggle below it —
            both pinned so they stay put while the grid scrolls. */}
        <div className="sticky top-0 z-30 -mx-4 mb-3 flex flex-col gap-2 bg-background/95 px-4 pb-2 pt-1 backdrop-blur-sm">
          {(activeTab === "products" || activeTab === "moodboards") && (
            <FilterSearchBar
              className="rounded-frame"
              value={searchTerm}
              onValueChange={handleSearchChange}
              filters={shouldShowFilters ? filterChips : undefined}
              pillPosition={shouldShowFilters ? "top" : "none"}
              variant="elevated"
              onSubmit={(searchTerm.trim().length > 0 || uploadedImageUrl) ? handleSubmit : undefined}
              onClear={handleClear}
              placeholder={activeTab === "moodboards" ? "search your boards & saves" : "search products…"}
              trailingAction={(searchTerm.trim().length > 0 || uploadedImageUrl) ? undefined : null}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              onImageUpload={handleImageUpload}
              isUploadingImage={isUploading}
              previewImageUrl={uploadedImageUrl}
              onClearImage={handleClearImage}
              showCompactPreview
              {...(activeTab === "moodboards"
                ? {
                    showFilterButton: false,
                    sortValue: moodboardSort,
                    onSortChange: (v: string) => setMoodboardSort(v as "recency" | "alphabetical"),
                    sortOptions: [
                      { value: "recency", label: "Recent" },
                      { value: "alphabetical", label: "A-Z" },
                    ],
                  }
                : {
                    leadingActions: null,
                  }
              )}
            />
          )}
          <div className="flex justify-center gap-2">
            {[
              { id: "moodboards", label: "Moodboards" },
              { id: "creations", label: "Creations" },
              { id: "products", label: "Products" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`rounded-[3px] border px-3.5 py-1.5 text-[11px] font-medium leading-none transition-colors ${
                  activeTab === tab.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-hairline bg-card text-ink hover:border-hairline-3 hover:bg-editorial/40"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {renderContent()}
      </div>

      <MoodboardPickerDrawer
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        moodboards={moodboards}
        defaultSelection={undefined}
        onSelect={() => setIsPickerOpen(false)}
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

function useResponsiveColumns() {
  const [columns, setColumns] = useState(2)

  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth
      if (width >= 1024) setColumns(4) // lg+ (capped at 4)
      else if (width >= 768) setColumns(3) // md
      else setColumns(2) // sm
    }

    updateColumns()
    window.addEventListener("resize", updateColumns)
    return () => window.removeEventListener("resize", updateColumns)
  }, [])

  return columns
}
