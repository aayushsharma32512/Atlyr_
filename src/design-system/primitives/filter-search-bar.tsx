import {
  ArrowUpNarrowWide,
  Image,
  Search as SearchIcon,
  SlidersHorizontal,
  X,
  Loader2,
  ArrowRight, // Use ArrowRight for submission like the starting state
} from "lucide-react"
import { type ChangeEvent, type KeyboardEvent, type ReactNode, useState, useMemo, useCallback, useRef } from "react"

import { cn } from "@/lib/utils"
import { useViewportZoomLockController } from "@/hooks/useViewportZoomLock"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { IconButton } from "./icon-button"
import { FilterDrawer, type FilterCategory } from "./filter-drawer"

export interface SortOption {
  value: string
  label: string
}

export interface FilterSearchBarAction {
  id: string
  ariaLabel?: string
  icon: ReactNode
  onClick?: () => void
  disabled?: boolean
}

export interface FilterSearchBarChip {
  id: string
  label: string
  isActive: boolean
  onActivate?: () => void
  onDeactivate?: () => void
}

type FilterSearchBarVariant = "flat" | "elevated"

interface FilterSearchBarProps {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  leadingActions?: FilterSearchBarAction[] | null
  trailingAction?: FilterSearchBarAction | null
  filters?: FilterSearchBarChip[]
  pillPosition?: "top" | "bottom" | "none"
  className?: string
  variant?: FilterSearchBarVariant
  inputName?: string
  onClear?: () => void
  clearButtonAriaLabel?: string
  onSubmit?: () => void
  onFocus?: () => void
  onBlur?: () => void
  
  // Filter and Sort props
  filterCategories?: FilterCategory[]
  activeFilters?: string[]
  onFilterApply?: (filters: string[]) => void
  onFilterClearAll?: () => void
  onFilterChange?: (filters: string[]) => void
  sortOptions?: SortOption[]
  defaultSortValue?: string
  sortValue?: string
  onSortChange?: (value: string) => void
  showFilterButton?: boolean

  // Image Search Props
  onImageUpload?: (file: File) => void
  isUploadingImage?: boolean
  previewImageUrl?: string
  onClearImage?: () => void
  showCompactPreview?: boolean
  alignPreviewTop?: boolean
}

const elevatedClasses = "rounded-xl px-2 pb-2"
const flatClasses = "rounded-xl px-1 py-1 shadow-sm"

const DEFAULT_SORT_OPTIONS: SortOption[] = [
  { value: "similarity", label: "Similarity" },
  { value: "price-low-high", label: "Price: Low to High" },
  { value: "price-high-low", label: "Price: High to Low" },
]

export function FilterSearchBar({
  value,
  onValueChange,
  placeholder = "Search outfits",
  leadingActions,
  trailingAction,
  filters,
  pillPosition = "none",
  className,
  variant = "flat",
  inputName,
  onClear,
  clearButtonAriaLabel = "Clear search input",
  onSubmit,
  onFocus,
  onBlur,
  filterCategories,
  activeFilters,
  onFilterApply,
  onFilterClearAll,
  onFilterChange,
  sortOptions = DEFAULT_SORT_OPTIONS,
  defaultSortValue,
  sortValue,
  onSortChange,
  onImageUpload,
  isUploadingImage = false,
  previewImageUrl,
  onClearImage,
  showCompactPreview = false,
  alignPreviewTop = false,
  showFilterButton = true,
}: FilterSearchBarProps) {
  const hasFilters = Boolean(filters && filters.length > 0 && pillPosition !== "none")
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { lock: lockViewportZoom, unlock: unlockViewportZoom } = useViewportZoomLockController()
  
  const [internalSortValue, setInternalSortValue] = useState<string | undefined>(defaultSortValue || "similarity")
  const isSortControlled = sortValue !== undefined
  const currentSortValue = isSortControlled ? sortValue : internalSortValue

  const handleSortChange = (newValue: string) => {
    if (!isSortControlled) {
      setInternalSortValue(newValue)
    }
    onSortChange?.(newValue)
  }

  const handleFilterClick = useCallback(() => {
    setIsFilterDrawerOpen(true)
  }, [])

  const activeFilterCount = (activeFilters || []).length

  const defaultLeadingActions = useMemo<FilterSearchBarAction[]>(() => {
    const actions: FilterSearchBarAction[] = []
    
    // Only add filter button if showFilterButton is true
    if (showFilterButton) {
      actions.push({
        id: "filter",
        ariaLabel: "Toggle filters",
        icon: (
          <div className="relative">
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">
                {activeFilterCount > 9 ? '9+' : activeFilterCount}
              </span>
            )}
          </div>
        ),
        onClick: handleFilterClick,
      })
    }
    
    // Always add sort button
    actions.push({
      id: "sort",
      ariaLabel: "Sort feed",
      icon: <ArrowUpNarrowWide className="h-4 w-4" />,
      onClick: undefined, 
    })
    
    return actions
  }, [handleFilterClick, activeFilterCount, showFilterButton])

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.value === "" && value !== "") {
      onClear?.();
    }
    onValueChange(event.target.value)
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmit?.()
    }
  }

  const handleInputFocus = () => {
    lockViewportZoom()
    onFocus?.()
  }

  const handleInputBlur = () => {
    if (previewImageUrl) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
    onBlur?.()
    requestAnimationFrame(() => {
      if (document.activeElement !== inputRef.current) {
        unlockViewportZoom()
      }
    })
  }

  const handleInputPointerDown = () => {
    lockViewportZoom()
  }

  const handleCameraClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && onImageUpload) {
      onImageUpload(file)
      // Refocus the input after image upload to prevent focus loss
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
    if (event.target) {
      event.target.value = "" 
    }
  }

  const filterChips = hasFilters ? (
    <div className={cn("flex gap-2", alignPreviewTop ? "items-start" : "items-end")}>
      <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
        <div className="inline-flex h-6 rounded-full border border-border bg-muted/40 p-0.5">
          {filters!.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={chip.onActivate}
              disabled={chip.isActive}
              className={cn(
                "relative rounded-full px-2 text-[11px] font-medium transition-all duration-200",
                chip.isActive ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={chip.isActive}
              aria-label={`Switch to ${chip.label}`}
            >
              <span className="truncate">{chip.label}</span>
            </button>
          ))}
        </div>
      </div>
      {previewImageUrl && !showCompactPreview && (
        <div className={cn("flex items-end")}>
          <div className="relative h-16 w-16 overflow-hidden rounded-md border border-border bg-muted/10">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                onClearImage?.()
              }}
              aria-label="Remove image"
              className="absolute left-0.1 top-0.1 z-20 h-6 w-6 rounded-full bg-white shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
            <img src={previewImageUrl} alt="Preview" className="h-full w-full object-cover" />
          </div>
        </div>
      )}
    </div>
  ) : null

  // --- TRAILING ACTIONS ---
  const renderTrailingActions = () => {
    // Determine if we have "Input" (Text OR Image)
    const hasInput = value.trim().length > 0 || !!previewImageUrl;

    return (
      <div className="flex h-full items-center gap-0.5 shrink-0">
        
        {/* 1. Camera (only when no preview) - shrink on mobile if overflow */}
        {onImageUpload && !previewImageUrl && (
          <div className="flex items-center shrink-0">
            <IconButton
               tone="ghost"
               size="md"
               className="h-full w-8 sm:w-9 text-muted-foreground hover:text-foreground"
               onMouseDown={(e) => e.preventDefault()}
               onClick={handleCameraClick}
               disabled={isUploadingImage}
               aria-label="Upload image"
            >
               {isUploadingImage ? (
                 <Loader2 className="h-4 w-4 animate-spin text-primary" />
               ) : (
                 <Image className="h-4 w-4" />
               )}
            </IconButton>
            {(hasInput) && <div className="h-4 w-[1px] bg-border mx-0.5" />}
          </div>
        )}

        {/* 2. Compact preview (shows before submit button when in results mode) */}
        {previewImageUrl && showCompactPreview && (
          <div className="flex items-center shrink-0">
            <div className="relative h-7 w-7 sm:h-8 sm:w-8 overflow-hidden rounded-md border border-border bg-muted/10">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  onClearImage?.()
                }}
                aria-label="Remove image"
                className="absolute left-0.5 top-0.5 z-20 h-4 w-4 rounded-full bg-white shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
              <img src={previewImageUrl} alt="Preview" className="h-full w-full object-cover" />
            </div>
          </div>
        )}

        {/* 3. Submit Button - Show arrow when there's input */}
        {hasInput && (
          <IconButton
            type="button"
            tone="ghost"
            size="md"
            className="h-full w-8 sm:w-9 text-muted-foreground hover:text-foreground shrink-0"
            onClick={onSubmit}
            aria-label="Submit search"
          >
            <ArrowRight className="h-4 w-4" /> 
          </IconButton>
        )}

        {/* 4. Custom trailing action (e.g., Refresh for force search) - always show if provided */}
        {trailingAction && (
           <IconButton
              key={trailingAction.id}
              type="button"
              tone="ghost"
              size="md"
              className="h-full w-8 sm:w-9 text-muted-foreground hover:text-foreground shrink-0"
              onClick={trailingAction.onClick || onSubmit}
              aria-label={trailingAction.ariaLabel}
              disabled={trailingAction.disabled}
            >
              {trailingAction.icon}
            </IconButton>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        variant === "elevated" ? elevatedClasses : flatClasses,
        hasFilters && pillPosition !== "none" ? "flex flex-col gap-0.5" : "",
        className,
      )}
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        accept="image/*" 
        className="hidden" 
        onChange={handleFileChange}
      />

      {hasFilters && pillPosition === "top" ? filterChips : null}

      <div className="flex h-10 w-full items-stretch rounded-xl border border-border bg-background/95">
        
        {leadingActions === undefined ? (
          <div className="flex h-full">
            {defaultLeadingActions.map((action, index) => {
              if (action.id === "sort") {
                return (
                  <div key={action.id} className="flex h-full">
                    <Select value={currentSortValue} onValueChange={handleSortChange}>
                      <SelectTrigger className={cn("h-full w-9 rounded-none border-r border-border text-muted-foreground px-2 py-0 border-none shadow-none focus:ring-0 [&>svg:not(.arrow-icon)]:hidden [&>span]:hidden", index === 0 ? "rounded-l-xl" : "")}>
                        <ArrowUpNarrowWide className="h-4 w-4 flex-shrink-0 arrow-icon" />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {sortOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              }
              return (
                <IconButton
                  key={action.id}
                  tone="ghost"
                  size="md"
                  className={cn("h-full w-9 rounded-none border-r border-border text-muted-foreground", index === 0 ? "rounded-l-xl" : "")}
                  onClick={action.onClick}
                >
                  {action.icon}
                </IconButton>
              )
            })}
          </div>
        ) : (leadingActions && leadingActions.length > 0) ? (
          <div className="flex h-full">
             {leadingActions.map((action, index) => (
               <IconButton
                 key={action.id}
                 tone="ghost"
                 size="md"
                 className={cn("h-full w-9 rounded-none border-r border-border text-muted-foreground", index === 0 ? "rounded-l-xl" : "")}
                 onClick={action.onClick}
               >
                 {action.icon}
               </IconButton>
             ))}
          </div>
        ) : null}

        <input
          ref={inputRef}
          name={inputName}
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent pl-2 pr-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          type="search"
          onKeyDown={handleInputKeyDown}
          onPointerDown={handleInputPointerDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
        />

        {renderTrailingActions()}
      </div>

      {hasFilters && pillPosition === "bottom" ? filterChips : null}

      {leadingActions === undefined && (
        <FilterDrawer
          open={isFilterDrawerOpen}
          onOpenChange={setIsFilterDrawerOpen}
          categories={filterCategories}
          activeFilters={activeFilters}
          onApply={onFilterApply}
          onClearAll={onFilterClearAll}
          onFilterChange={onFilterChange}
        />
      )}
    </div>
  )
}
