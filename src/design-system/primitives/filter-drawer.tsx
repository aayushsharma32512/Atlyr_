import { useState, useEffect, useRef } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface FilterOption {
  id: string
  label: string
}

export interface FilterCategory {
  id: string
  label: string
  options: FilterOption[]
}

export interface FilterDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories?: FilterCategory[]
  activeFilters?: string[]
  onApply?: (filters: string[]) => void
  onClearAll?: () => void
  onFilterChange?: (filters: string[]) => void
}

const defaultCategories: FilterCategory[] = [
  {
    id: "gender",
    label: "Gender",
    options: [
      { id: "men", label: "Men" },
      { id: "women", label: "Women" },
      { id: "unisex", label: "Unisex" },
    ],
  },
  {
    id: "category",
    label: "Category",
    options: [
      { id: "tops", label: "Tops" },
      { id: "dresses", label: "Dresses" },
      { id: "activewear", label: "Activewear" },
      { id: "shirts", label: "Shirts" },
      { id: "outerwear", label: "Outerwear" },
    ],
  },
  {
    id: "brand",
    label: "Brand",
    options: [
      { id: "zara", label: "Zara" },
      { id: "adidas", label: "Adidas" },
      { id: "uniqlo", label: "Uniqlo" },
      { id: "hm", label: "H&M" },
      { id: "mango", label: "Mango" },
      { id: "gap", label: "Gap" },
    ],
  },
  {
    id: "fit",
    label: "Fit",
    options: [
      { id: "slim-fit", label: "Slim Fit" },
      { id: "loose-fit", label: "Loose Fit" },
      { id: "regular-fit", label: "Regular Fit" },
      { id: "oversized", label: "Oversized" },
    ],
  },
  {
    id: "feel",
    label: "Feel",
    options: [
      { id: "soft", label: "Soft" },
      { id: "crisp", label: "Crisp" },
      { id: "stretchy", label: "Stretchy" },
      { id: "cozy", label: "Cozy" },
    ],
  },
  {
    id: "vibe",
    label: "Vibe",
    options: [],
  },
]

export function FilterDrawer({
  open,
  onOpenChange,
  categories = defaultCategories,
  activeFilters: externalActiveFilters,
  onApply,
  onClearAll,
  onFilterChange,
}: FilterDrawerProps) {
  // Always use local draft state for filters while drawer is open
  const [draftFilters, setDraftFilters] = useState<Set<string>>(
    new Set(externalActiveFilters || [])
  )
  const [minPrice, setMinPrice] = useState("0")
  const [maxPrice, setMaxPrice] = useState("0")

  const isControlled = externalActiveFilters !== undefined

  // Sync draft filters with external filters only when the drawer OPEN state
  // transitions from closed -> open.
  const prevOpenRef = useRef<boolean>(false)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDraftFilters(new Set(externalActiveFilters || []))

      // Initialize price range from active filters
      const priceFilter = (externalActiveFilters || []).find(f => f.startsWith('price:'))
      if (priceFilter) {
        const [_, range] = priceFilter.split(':')
        const [min, max] = range.split('-')
        setMinPrice(min || '0')
        setMaxPrice(max || '0')
      } else {
        setMinPrice('0')
        setMaxPrice('0')
      }
    }
    prevOpenRef.current = open
  }, [open, externalActiveFilters])

  // --- CLEANUP EFFECT: Remove invalid filters from draft if categories change ---
  // This runs if the user selects a "Type" which updates 'categories', removing incompatible options.
  useEffect(() => {
    // We only care if the drawer is open and we have categories to check against
    if (!open || !categories || categories.length === 0) return

    setDraftFilters(prev => {
       const next = new Set(prev)
       let changed = false

       prev.forEach(filterId => {
          // Skip Price
          if (filterId.startsWith('price:')) return
          
          // Identify which category this filter belongs to
          const [catPrefix] = filterId.split(':')
          // "type" filters are usually valid since they drove the change, so we keep them
          if (catPrefix === 'type') return

          // Find the category object in props
          const category = categories.find(c => c.id === catPrefix)
          
          // If we found the category, check if this option exists
          if (category) {
             const isValidOption = category.options.some(opt => opt.id === filterId)
             if (!isValidOption) {
                next.delete(filterId)
                changed = true
             }
          }
       })

       return changed ? next : prev
    })
  }, [categories, open])


  const handleFilterToggle = (filterId: string) => {
    setDraftFilters((prev) => {
      const newFilters = new Set(prev)
      if (newFilters.has(filterId)) {
        newFilters.delete(filterId)
      } else {
        newFilters.add(filterId)
      }

      // Only notify parent for real-time updates when a TYPE is toggled.
      // Other categories (brand, category, etc.) should remain draft-only
      // until the user presses Apply.
      if (onFilterChange && filterId.startsWith('type:')) {
        onFilterChange(Array.from(newFilters))
      }

      return newFilters
    })
  }

  const handleRemoveFilter = (filterId: string) => {
    setDraftFilters((prev) => {
      const newFilters = new Set(prev)
      newFilters.delete(filterId)

      // If removing a type, notify parent for real-time update
      if (onFilterChange && filterId.startsWith('type:')) {
        onFilterChange(Array.from(newFilters))
      }

      return newFilters
    })
  }

  const handleClearAll = () => {
    setDraftFilters(new Set())
    setMinPrice("0")
    setMaxPrice("0")
  }

  const handleApply = () => {
    let filters = Array.from(draftFilters)
    
    // Remove any existing price filters first
    filters = filters.filter(f => !f.startsWith('price:'))
    
    // Add price range as a filter if either min or max is set
    const minVal = parseFloat(minPrice) || 0
    const maxVal = parseFloat(maxPrice) || 0
    
    if (minVal > 0 || maxVal > 0) {
      // Format: "price:min-max", where empty means no limit
      const priceFilter = `price:${minVal}-${maxVal || ''}`
      filters.push(priceFilter)
    }
    
    onApply?.(filters)
    onOpenChange(false)
  }

  // Get currently displayed filters (draft while drawer is open)
  const displayedFilters = Array.from(draftFilters)

  const getFilterLabel = (filterId: string) => {
    for (const category of categories) {
      const option = category.options.find((opt) => opt.id === filterId)
      if (option) return option.label
    }
    return filterId
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[95vh]">
        <DrawerHeader className="flex flex-row items-center justify-between px-6 pb-4">
          <DrawerTitle className="text-lg font-semibold">Filters</DrawerTitle>
          <DrawerDescription className="sr-only">
            Set filters to refine results.
          </DrawerDescription>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        {/* Active Filters - Horizontal Scrollable */}
        {displayedFilters.length > 0 && (
          <div className="pb-4">
             <ScrollArea className="w-full whitespace-nowrap pb-2">
               <div className="flex w-max space-x-2 px-6">
                {displayedFilters.map((filterId) => (
                  <Badge
                    key={filterId}
                    variant="secondary"
                    className="gap-1.5 px-2.5 py-1 text-xs border-sidebar-border h-8 rounded-lg"
                  >
                    {getFilterLabel(filterId)}
                    <button
                      onClick={() => handleRemoveFilter(filterId)}
                      className="ml-1 hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Filter Content */}
        <ScrollArea className="flex-1 px-6 scrollbar-hide overflow-scroll">
          <div className="space-y-6 pb-4">
            
            {/* Price Range */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Price Range</Label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">₹</span>
                  <Input
                    type="number"
                    placeholder="0"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="pl-7"
                  />
                </div>
                <span className="text-muted-foreground">-</span>
                 <div className="relative flex-1">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">₹</span>
                  <Input
                    type="number"
                    placeholder="0"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    className="pl-7"
                  />
                </div>
              </div>
            </div>
            {categories.map((category) => (
              <div key={category.id} className="space-y-3">
                <Label className="text-sm font-medium">{category.label}</Label>
                {category.options.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-8 space-y-0 gap-y-2.5">
                    {category.options.map((option) => {
                      const isChecked = displayedFilters.includes(option.id)
                      return (
                        <div
                          key={option.id}
                          className="flex items-center space-x-2"
                        >
                          <Checkbox
                            className="border-sidebar-border size-4 rounded-sm"
                            id={option.id}
                            checked={isChecked}
                            onCheckedChange={() => handleFilterToggle(option.id)}
                          />
                          <Label
                            htmlFor={option.id}
                            className="text-sm font-normal text-foreground cursor-pointer"
                          >
                            {option.label}
                          </Label>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No options available</p>
                )}
              </div>
            ))}

          </div>
        </ScrollArea>

        {/* Footer */}
        <DrawerFooter className="flex flex-row gap-3 px-6 pb-6">
          <Button
            variant="outline"
            onClick={handleClearAll}
            className="flex-1"
            disabled={displayedFilters.length === 0 && minPrice === "0" && maxPrice === "0"}
          >
            Clear All
          </Button>
          <Button onClick={handleApply} className="flex-1 bg-foreground text-background">
            Apply
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}