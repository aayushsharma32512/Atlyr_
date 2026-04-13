import { useCallback, useMemo, useState } from "react";
import { Plus, ArrowUpNarrowWide } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
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
      className={`bg-white/95 backdrop-blur-md px-2 sm:px-4 py-2 sm:py-3 box-border ${className || ''}`}
      style={style}
    >
      <div className="flex items-center justify-between mb-1 p-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="pl-3 text-sm sm:text-base font-medium text-gray-900">{resolvedName}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex gap-2 sm:gap-4 text-sm sm:text-base text-gray-600 sm:mt-0 sm:mr-2">
            <span>
              <span className="font-medium text-gray-900">{resolvedCreationsCount}</span>{" "}
              <span>creations</span>
            </span>
          </div>
          <Button
            variant="ghost"
            className="bg-card text-sm sm:text-base font-medium text-foreground shadow-none hover:bg-muted/40"
            size="sm"
            onClick={onAddMoodboard}
          >
            Add <Plus className="h-4 w-4" />
          </Button>
          {/* <IconButton tone="subtle" size="xxs" aria-label="Add collection" onClick={onAddMoodboard}>
            <Plus className="h-3 w-3" />
          </IconButton> */}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex justify-around mt-1 pt-1">
        {categoryTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`text-sm font-medium px-4 py-1 rounded-full transition-colors ${activeTab === tab.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  )
}

export default CollectionsHeader
