import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useState } from "react"

import { ArrowUpNarrowWide, SlidersHorizontal } from "lucide-react"
import { FilterDrawer, type FilterCategory } from "./filter-drawer"

export interface SortOption {
  value: string
  label: string
}

export interface FilterSortBarProps {
  onFilterClick?: () => void
  onSortChange?: (value: string) => void
  onFilterApply?: (filters: string[]) => void
  onFilterClearAll?: () => void
  filterLabel?: string
  sortLabel?: string
  sortOptions?: SortOption[]
  defaultSortValue?: string
  value?: string
  filterCategories?: FilterCategory[]
  activeFilters?: string[]
  className?: string
}

export function FilterSortBar({
  onFilterClick,
  onSortChange,
  onFilterApply,
  onFilterClearAll,
  filterLabel = "Filter",
  sortLabel = "Sort",
  sortOptions = [
    { value: "recommended", label: "Recommended" },
    { value: "similarity", label: "Similarity" },
    { value: "rating", label: "Rating" },
    { value: "popularity", label: "Popularity" },
    { value: "price-high-to-low", label: "Price: High to Low" },
  ],
  defaultSortValue,
  value,
  filterCategories,
  activeFilters,
  className,
}: FilterSortBarProps) {
  const [internalValue, setInternalValue] = useState<string | undefined>(defaultSortValue)
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false)
  const isControlled = value !== undefined
  const currentValue = isControlled ? value : internalValue

  const handleValueChange = (newValue: string) => {
    if (!isControlled) {
      setInternalValue(newValue)
    }
    onSortChange?.(newValue)
  }

  const handleFilterClick = () => {
    if (onFilterClick) {
      onFilterClick()
    } else {
      setIsFilterDrawerOpen(true)
    }
  }

  return (
    <>
      <div className={cn("flex items-center justify-center gap-1", className)}>
        <Button
          type="button"
          variant="ghost"
          onClick={handleFilterClick}
          className={cn(
            "flex-1 h-8 gap-2 rounded-lg shadow-none ",
            "bg-card px-2 py-1 text-xs shadow-none font-medium text-foreground",
            "hover:bg-muted/40 shadow-none",
          )}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          <span>{filterLabel}</span>
        </Button>

        <span className="h-6 w-px bg-border/60" aria-hidden="true" />

        <Select
          value={currentValue || undefined}
          onValueChange={handleValueChange}
        >
          <SelectTrigger 
            className={cn(
              "flex-1 h-8 gap-2 rounded-lg border-b border-sidebar-border",
              "bg-card px-3 py-1 text-xs font-medium text-foreground",
              "hover:bg-muted/40",
              "border-none focus:ring-0 focus:ring-offset-0",
              "justify-start min-w-0 overflow-hidden",
              "[&>span]:truncate [&>span]:max-w-full",
              "[&>svg:not(.arrow-icon)]:hidden"
            )}
          >
            <ArrowUpNarrowWide className="size-4 flex-shrink-0 arrow-icon" aria-hidden="true" />
            <SelectValue placeholder={sortLabel} />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!onFilterClick && (
        <FilterDrawer
          open={isFilterDrawerOpen}
          onOpenChange={setIsFilterDrawerOpen}
          categories={filterCategories}
          activeFilters={activeFilters}
          onApply={onFilterApply}
          onClearAll={onFilterClearAll}
        />
      )}
    </>
  )
}


