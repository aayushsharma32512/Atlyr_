import { useCallback, useMemo, useState } from "react";
import { Plus, ArrowUpNarrowWide } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { WordmarkLockup } from "@/design-system/primitives"
// import type { Database } from "@/integrations/supabase/types";



interface CollectionsHeaderProps {
  onAddMoodboard?: () => void
  activeTab: string
  onTabChange: (tab: string) => void
  userName?: string | null
  creationsCount?: number
  className?: string
  style?: React.CSSProperties
  sortValue?: string
  onSortChange?: (value: string) => void
}

const CollectionsHeader = ({
  onAddMoodboard,
  activeTab,
  onTabChange,
  userName,
  creationsCount,
  className,
  style,
  sortValue,
  onSortChange,
}: CollectionsHeaderProps) => {
  const navigate = useNavigate()
  const { toast } = useToast()
  const resolvedName = userName?.trim() ? userName : "Profile"
  const resolvedCreationsCount = Number.isFinite(creationsCount) ? creationsCount : 0

  // // --- FILTER OPTIONS ---
  // const productFilterOptions = useProductFilterOptions()
  // const [activeFilters, setActiveFilters] = useState<string[]>([])

  // // Transform product filter options to FilterCategory format
  // const filterCategories = useMemo<FilterCategory[]>(() => {
  //   if (!productFilterOptions.data) return []

  //   const categories: FilterCategory[] = []

  //   // Add types
  //   if (productFilterOptions.data.types.length > 0) {
  //     categories.push({
  //       id: "type",
  //       label: "Type",
  //       options: productFilterOptions.data.types.map(type => ({
  //         id: `type:${type}`,
  //         label: type
  //       }))
  //     })
  //   }

  //   // Add brands
  //   if (productFilterOptions.data.brands.length > 0) {
  //     categories.push({
  //       id: "brand",
  //       label: "Brand",
  //       options: productFilterOptions.data.brands.map(brand => ({
  //         id: `brand:${brand}`,
  //         label: brand
  //       }))
  //     })
  //   }

  //   // Add genders
  //   if (productFilterOptions.data.genders.length > 0) {
  //     categories.push({
  //       id: "gender",
  //       label: "Gender",
  //       options: productFilterOptions.data.genders.map(gender => ({
  //         id: `gender:${gender}`,
  //         label: gender
  //       }))
  //     })
  //   }

  //   // Add categories
  //   if (productFilterOptions.data.categoryIds.length > 0) {
  //     categories.push({
  //       id: "category",
  //       label: "Category",
  //       options: productFilterOptions.data.categoryIds.map(category => ({
  //         id: `category:${category}`,
  //         label: category
  //       }))
  //     })
  //   }

  //   return categories
  // }, [productFilterOptions.data])



  // // Search state - matching HomeScreen implementation
  // const [searchTerm, setSearchTerm] = useState("")
  // const [activeFilter, setActiveFilter] = useState<"products" | "outfits">("outfits")
  // const [uploadedImageUrl, setUploadedImageUrl] = useState<string | undefined>(undefined)
  // const searchImageUpload = useSearchImageUpload()
  // const isUploading = searchImageUpload.isPending

  // // --- SORT HANDLER ---
  // const handleSortChange = useCallback((value: string) => {
  //   console.log('[CollectionsHeader] Sort changed to:', value)
  //   setSortValue(value)
  // }, [])

  // const handleSearchChange = useCallback((value: string) => {
  //   setSearchTerm(value)
  // }, [])

  // const handleImageUpload = useCallback(async (file: File) => {
  //   try {
  //     const publicUrl = await searchImageUpload.mutateAsync(file)

  //     setUploadedImageUrl(publicUrl)
  //     setActiveFilter("products")
  //   } catch (error) {
  //     console.error("Image upload failed:", error)
  //     toast({ title: "Upload failed", description: "Could not upload image", variant: "destructive" })
  //   }
  // }, [searchImageUpload, toast])

  // const handleClearImage = useCallback(() => {
  //   setUploadedImageUrl(undefined)
  // }, [])

  // const handleSubmit = useCallback(() => {
  //   const trimmed = searchTerm.trim()
  //   if (trimmed.length === 0 && !uploadedImageUrl) {
  //     return
  //   }

  //   // Navigate to /search route with query params - same as HomeScreen
  //   const params = new URLSearchParams()
  //   if (trimmed.length > 0) {
  //     params.set("search", trimmed)
  //   }
  //   if (uploadedImageUrl) {
  //     params.set("imageUrl", encodeURIComponent(uploadedImageUrl))
  //   }
  //   params.set("mode", activeFilter)
  //   navigate(`/search?${params.toString()}`)
  // }, [activeFilter, navigate, searchTerm, uploadedImageUrl])

  // const handleClear = useCallback(() => {
  //   setSearchTerm("")
  // }, [])

  // const handleFilterChange = useCallback((next: "products" | "outfits") => {
  //   setActiveFilter(next)
  // }, [])

  // const handleFilterToggle = useCallback(() => {
  //   const next = activeFilter === "products" ? "outfits" : "products"
  //   handleFilterChange(next)
  // }, [activeFilter, handleFilterChange])

  // const filterChips: FilterSearchBarChip[] = [
  //   {
  //     id: "products",
  //     label: "Products",
  //     isActive: activeFilter === "products",
  //     onActivate: () => handleFilterChange("products"),
  //     onDeactivate: () => handleFilterToggle(),
  //   },
  //   {
  //     id: "outfits",
  //     label: "Outfits",
  //     isActive: activeFilter === "outfits",
  //     onActivate: () => handleFilterChange("outfits"),
  //     onDeactivate: () => handleFilterToggle(),
  //   },
  // ]

  // Sort options for moodboards tab
  const moodboardSortOptions = [
    { value: "recency", label: "Recent" },
    { value: "alphabetical", label: "A-Z" },
  ]

  const categoryTabs = [
    { id: "moodboards", label: "Moodboards" },
    { id: "creations", label: "Creations" },
    { id: "products", label: "Products" },
  ]

  return (
    <header
      className={`border-b border-hairline bg-background/95 backdrop-blur-sm px-2 sm:px-4 py-2 sm:py-3 box-border ${className || ''}`}
      style={style}
    >
      {/* House wordmark — कलागृह, left-aligned to match every other screen header. */}
      <div className="flex justify-start pb-1.5 pt-0.5 pl-3">
        <WordmarkLockup size="header" />
      </div>

      <div className="flex items-end justify-between mb-1 px-3 pt-1">
        <div className="flex flex-col">
          {/* Editorial screen title — the canvas leads Boards with a serif headline. */}
          <h1 className="font-display text-[26px] font-medium leading-none text-foreground">Your boards</h1>
          <p className="mt-1.5 text-[11px] text-taupe">
            {resolvedName} · <span className="font-medium text-foreground">{resolvedCreationsCount}</span> creations
          </p>
        </div>
        <Button
          variant="ghost"
          className="bg-card text-sm font-medium text-foreground shadow-none hover:bg-editorial/40"
          size="sm"
          onClick={onAddMoodboard}
        >
          Add <Plus className="h-4 w-4" />
        </Button>
      </div>
      {/* Category tabs moved into the content area — they now sit BELOW the search
          bar (rendered by CollectionsPage), not inside this header. */}
    </header>
  )
}

export default CollectionsHeader
