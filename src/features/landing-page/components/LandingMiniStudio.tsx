/**
 * LandingMiniStudio - Self-contained mini studio for the landing page
 * 
 * DATA SOURCE:
 * - All product data is loaded from: /src/data/landingMockProducts.ts
 * - To change products, edit MOCK_OUTFIT_ITEMS (default outfit) and MOCK_ALTERNATIVES (grid products)
 * - Product data was extracted from: /docs/Supabase Snippet Product Table Columns.csv
 * - Use /scripts/extract-landing-products.cjs to re-extract data from CSV
 * 
 * UNDO/REDO:
 * - Follows the same pattern as useStudioHistory (past/present/future stacks)
 * - Local state only (not persisted to localStorage or URL)
 * 
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Columns2, Redo2, Undo2, Share, Info, Shirt, Footprints, X } from "lucide-react"

import { cn } from "@/lib/utils"
import logoImage from "/assets/logo.png"
import { useToast } from "@/hooks/use-toast"
import { IconButton, OutfitInspirationTile } from "@/design-system/primitives"
import { Button } from "@/components/ui/button"
import type { StudioRenderedItem } from "@/features/studio/types"
import { useMiniStudioTour } from "../hooks/useMiniStudioTour"
import { MiniStudioTour } from "./MiniStudioTour"
import { useQueryClient } from "@tanstack/react-query"
import { studioKeys } from "@/features/studio/queryKeys"
import { preloadMannequinSegments } from "@/features/studio/components/AvatarRenderer"
import {
  MOCK_OUTFIT_ITEMS_FEMALE,
  MOCK_OUTFIT_ITEMS_MALE,
  getAlternativesByType,
  toRenderedItem,
  isDressProduct,
  getLocalMannequinConfig,
  type LandingMockProduct,
} from "@/features/landing-page/landingMockProducts"

type SlotType = "top" | "bottom" | "shoes"

type OutfitState = {
  top: LandingMockProduct
  bottom: LandingMockProduct
  shoes: LandingMockProduct
}

type ViewMode = "studio" | "alternatives"

// History state following useStudioHistory pattern
type HistoryState = {
  past: OutfitState[]
  present: OutfitState
  future: OutfitState[]
}

const MAX_HISTORY = 7


// Custom bottom icon matching the studio
const BottomIcon = ({ className }: { className?: string }) => (
  <svg width="14" height="12" viewBox="0 0 21 18" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path fillRule="evenodd" clipRule="evenodd" d="M1.71599 0.0343769C1.52044 0.095399 1.36568 0.238497 1.27195 0.445235C1.23115 0.535043 1.2271 0.601418 1.22675 1.20438C1.22627 1.77119 1.21949 1.90096 1.17881 2.11817C0.667436 4.84774 0.359233 7.47455 0.13953 10.9774C0.0674454 12.1263 0 14.0089 0 14.8721C0 15.5305 0.0176048 15.6081 0.209354 15.7999C0.40039 15.991 0.384213 15.9875 1.71207 16.1137C1.90929 16.1325 2.52343 16.1894 3.07691 16.2403C3.63051 16.2912 4.18744 16.3431 4.31472 16.3556C4.66753 16.3903 5.18854 16.4392 6.29264 16.5411C6.84612 16.5922 7.45516 16.6496 7.64607 16.6686C8.16803 16.7209 8.4057 16.7154 8.5507 16.6478C8.69035 16.5828 8.81846 16.4611 8.88554 16.3296C8.93384 16.2351 9.02186 15.9135 9.7295 13.2502C9.86725 12.7316 9.98692 12.3152 9.99536 12.3248C10.0037 12.3345 10.0487 12.4933 10.0952 12.6778C10.1416 12.8623 10.2153 13.1486 10.2588 13.314C10.3024 13.4794 10.4904 14.203 10.6767 14.9218C10.863 15.6408 11.0377 16.274 11.065 16.3289C11.1253 16.4506 11.2818 16.5988 11.4127 16.6583C11.5351 16.7139 11.8098 16.7171 12.3094 16.6688C12.5057 16.6499 13.1191 16.5929 13.6726 16.5422C14.2261 16.4915 14.7311 16.4448 14.7947 16.4384C14.8583 16.4319 15.587 16.364 16.4141 16.2875C17.9602 16.1445 18.4108 16.1026 19.0515 16.0419C19.255 16.0225 19.4708 15.991 19.5309 15.9717C19.6784 15.9243 19.855 15.7608 19.9352 15.5975L20 15.4656L19.9956 14.8293C19.9875 13.67 19.9144 12.0582 19.7899 10.295C19.6515 8.33278 19.4458 6.38733 19.1884 4.60377C19.1012 3.99974 18.8745 2.63323 18.8295 2.44076C18.8129 2.36963 18.7969 1.97745 18.7881 1.42278L18.7738 0.520531L18.706 0.398249C18.6155 0.234691 18.4748 0.109435 18.3142 0.0493648L18.1822 0L9.99917 0.00154637C3.19682 0.00285481 1.79926 0.00832659 1.71599 0.0343769Z" fill="currentColor" />
  </svg>
)

// Helper to compare outfit states
function outfitsEqual(a: OutfitState, b: OutfitState): boolean {
  return a.top.id === b.top.id && a.bottom.id === b.bottom.id && a.shoes.id === b.shoes.id
}

export function LandingMiniStudio() {
  const { toast } = useToast()
  const tour = useMiniStudioTour() // Re-initialize tour
  
  // Auto-start tour if not seen
  useEffect(() => {
    if (!tour.hasSeenTour && !tour.isActive) {
       // Small delay to ensure everything is rendered/settled
       const timer = setTimeout(() => {
         tour.startTour()
       }, 1000)
       return () => clearTimeout(timer)
    }
  }, [tour.hasSeenTour, tour.isActive, tour.startTour])

  // Tour advance helper with delay for smooth transitions
  const advanceTour = useCallback((stepId: string) => {
    if (tour.isActive && tour.getCurrentStep()?.id === stepId) {
      tour.nextStep()
    }
  }, [tour])

  // Pre-populate cache with LOCAL mannequin config and preload SVGs
  // This ensures AvatarRenderer mounts with everything already in cache - no loading state!
  const queryClient = useQueryClient()
  
  useEffect(() => {
    const preload = async () => {
      // Get local configs
      const femaleConfig = getLocalMannequinConfig("female")
      const maleConfig = getLocalMannequinConfig("male")
      
      // Pre-populate React Query cache
      queryClient.setQueryData(studioKeys.mannequin("female", null), femaleConfig)
      queryClient.setQueryData(studioKeys.mannequin("male", null), maleConfig)
      
      // Preload SVG assets into AvatarRenderer's cache (also saves to localStorage)
      await Promise.all([
        preloadMannequinSegments(femaleConfig),
        preloadMannequinSegments(maleConfig),
      ])
    }
    preload()
  }, [queryClient])

  // Gender state
  const [activeGender, setActiveGender] = useState<"male" | "female">("female")
  
  // Track when avatar is fully loaded (assets + items) to sync hair visibility
  const [avatarReady, setAvatarReady] = useState(false)

  // Initial outfit state (defaults to female)
  const initialOutfit: OutfitState = {
    top: MOCK_OUTFIT_ITEMS_FEMALE.top,
    bottom: MOCK_OUTFIT_ITEMS_FEMALE.bottom,
    shoes: MOCK_OUTFIT_ITEMS_FEMALE.shoes,
  }

  // History state following useStudioHistory pattern (past/present/future)
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialOutfit,
    future: [],
  })

  // View mode: studio (full mannequin) or alternatives (split view)
  const [viewMode, setViewMode] = useState<ViewMode>("studio")
  
  // Active slot being browsed (for alternatives view)
  const [activeSlot, setActiveSlot] = useState<SlotType>("top")
  
  // Sync tour step view requirements
  useEffect(() => {
    if (!tour.isActive) return
    const step = tour.getCurrentStep()
    if (!step) return
    
    if (step.requiresSplitView && viewMode === 'studio') {
      setViewMode('alternatives')
    } else if (step.requiresSplitView === false && viewMode === 'alternatives') {
      setViewMode('studio')
    }
  }, [tour.currentStepIndex, tour.isActive])

  // Current outfit is history.present
  const outfit = history.present

  const dressActive = useMemo(() => {
    return activeGender === "female" && isDressProduct(outfit.top)
  }, [activeGender, outfit.top])

  // Convert current outfit to StudioRenderedItem array for OutfitInspirationTile
  const renderedItems = useMemo<StudioRenderedItem[]>(() => {
    const items: StudioRenderedItem[] = [toRenderedItem(outfit.top)]
    if (!dressActive) {
      items.push(toRenderedItem(outfit.bottom))
    }
    items.push(toRenderedItem(outfit.shoes))
    return items
  }, [outfit, dressActive])

  // Track which zone is animating (for per-item animations)
  const [animatingZone, setAnimatingZone] = useState<SlotType | null>(null)
  const prevOutfitRef = useRef<OutfitState>(outfit)

  // Detect which zone changed and trigger animation
  useEffect(() => {
    const prev = prevOutfitRef.current
    let changedZone: SlotType | null = null
    
    if (prev.top.id !== outfit.top.id) changedZone = "top"
    else if (prev.bottom.id !== outfit.bottom.id) changedZone = "bottom"
    else if (prev.shoes.id !== outfit.shoes.id) changedZone = "shoes"
    
    if (changedZone) {
      setAnimatingZone(changedZone)
      // Clear animation after it completes
      const timer = setTimeout(() => setAnimatingZone(null), 350)
      return () => clearTimeout(timer)
    }
    
    prevOutfitRef.current = outfit
  }, [outfit])

  // Update ref when outfit changes
  useEffect(() => {
    prevOutfitRef.current = outfit
  }, [outfit])

  // Handle gender change
  const handleGenderChange = useCallback((gender: "male" | "female") => {
    advanceTour('gender')
    
    if (gender === activeGender) return
    
    setActiveGender(gender)
    const defaults = gender === "male" ? MOCK_OUTFIT_ITEMS_MALE : MOCK_OUTFIT_ITEMS_FEMALE
    
    const newOutfit = {
      top: defaults.top,
      bottom: defaults.bottom,
      shoes: defaults.shoes,
    }
    
    // Reset history with new gender default
    setHistory({
      past: [],
      present: newOutfit,
      future: [],
    })
  }, [activeGender, advanceTour])

  // Get filtered alternatives based on active slot AND gender
  const alternatives = useMemo(() => {
    return getAlternativesByType(activeSlot).filter(item => 
      // Filter by gender if specified, otherwise include unisex/undefined
      !item.gender || item.gender === activeGender || item.gender === "unisex"
    )
  }, [activeSlot, activeGender])

  // Record a change (following useStudioHistory.recordChange pattern)
  const recordChange = useCallback((nextOutfit: OutfitState) => {
    setHistory((prev) => {
      if (outfitsEqual(prev.present, nextOutfit)) {
        return prev
      }
      const nextPast = [...prev.past, prev.present]
      const cappedPast = nextPast.length > MAX_HISTORY 
        ? nextPast.slice(nextPast.length - MAX_HISTORY) 
        : nextPast
      return {
        past: cappedPast,
        present: nextOutfit,
        future: [],
      }
    })
  }, [])

  // Handle product selection from grid
  const handleProductSelect = useCallback(
    (product: LandingMockProduct) => {
      const isDress = isDressProduct(product)
      if (dressActive && product.type === "bottom") {
        toast({ title: "Dress selected", description: "Bottoms are hidden with this dress." })
        return
      }

      const nextOutfit = {
        ...outfit,
        [product.type]: product,
      }
      recordChange(nextOutfit)
      advanceTour('product-grid')

      if (isDress) {
        setActiveSlot("top")
      } else if (product.type === "top" && dressActive) {
        setViewMode((prev) => prev)
      }
    },
    [outfit, recordChange, tour, advanceTour, dressActive, toast]
  )

  // Handle clicking on mannequin item
  const handleMannequinItemClick = useCallback((item: { type: string }) => {
    const zoneToSlot: Record<string, SlotType> = {
      top: "top",
      bottom: "bottom",
      shoes: "shoes",
    }
    const clickedSlot = zoneToSlot[item.type]
    if (!clickedSlot) return

    if (dressActive && clickedSlot === "bottom") {
      toast({ title: "Bottom hidden", description: "This dress already covers bottoms." })
      return
    }
    
    setActiveSlot(clickedSlot)
    setViewMode("alternatives")
    
    advanceTour('mannequin')
  }, [tour, advanceTour, dressActive, toast])

  const handleSlotChange = useCallback((slot: SlotType) => {
    if (dressActive && slot === "bottom") {
      toast({ title: "Bottom hidden", description: "Switch to a top to change bottoms." })
      return
    }
    setActiveSlot(slot)
    
    advanceTour('category-tabs')
  }, [tour, advanceTour, dressActive, toast])

  const handleBackToStudio = useCallback(() => {
    setViewMode("studio")
    advanceTour('close-split')
  }, [advanceTour])

  const handleOpenSplitView = useCallback(() => {
    setViewMode("alternatives")
  }, [])

  // Undo action
  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) return prev
      const previous = prev.past[prev.past.length - 1]
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future],
      }
    })
    advanceTour('history')
  }, [advanceTour])

  // Redo action
  const handleRedo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev
      const next = prev.future[0]
      return {
        past: [...prev.past, prev.present].slice(-MAX_HISTORY),
        present: next,
        future: prev.future.slice(1),
      }
    })
    advanceTour('history')
  }, [advanceTour])

  // Share action
  const handleShare = useCallback(async () => {
    advanceTour('share')
    
    const shareUrl = typeof window === "undefined" ? "/" : `${window.location.origin}/`
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ 
          title: "Check out this outfit on Snippet", 
          text: "Style your look with AI-powered outfit recommendations",
          url: shareUrl 
        })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl)
        toast({ title: "Link copied" })
        return
      } catch {
        // Fall through
      }
    }
    toast({ title: "Unable to copy link", description: "Please copy the URL from the address bar." })
  }, [toast])

  const handleInfo = useCallback(() => {
    // Start tour on info click
    tour.startTour()
  }, [tour])

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const categories: { id: SlotType; label: string; icon: React.ElementType }[] = [
    { id: "top", label: "Top", icon: Shirt },
    { id: "bottom", label: "Bottom", icon: BottomIcon },
    { id: "shoes", label: "Shoes", icon: Footprints },
  ]

  // ===== RENDER STUDIO =====
  // Using a unified layout with CSS transitions for smooth animations
  const isStudioMode = viewMode === "studio"

  return (
    <div className="mx-auto flex h-[520px] w-full max-w-[430px] overflow-hidden rounded-[34px] bg-background relative">
      <div className="relative flex h-full w-full">
        {/* Left Panel - Mannequin/Outfit View */}
        <section 
          className={cn(
            "relative flex h-full flex-col items-center justify-center overflow-hidden transition-all duration-300 ease-out",
            isStudioMode ? "w-full" : "w-[55%] border-r border-border/30"
          )}
        >
          {/* Logo - Top Left */}
          <div className="absolute top-2 left-4 z-10">
            <img src={logoImage} alt="ATLYR" className="h-10 w-auto" />
          </div>

          {/* Gender Selector */}
          <div className={cn(
            "absolute bottom-3 left-3 flex gap-1 rounded-full bg-card/80 p-1 backdrop-blur-sm transition-all duration-300",
            tour.isHighlighted('gender') ? "z-50 scale-105 shadow-xl ring-2 ring-primary/50" : "z-10"
          )}>
            <button
              type="button"
              onClick={() => handleGenderChange("female")}
              className={cn(
                "rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                activeGender === "female" 
                  ? "bg-primary text-white shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isStudioMode ? "Female" : "F"}
            </button>
            <button
              type="button"
              onClick={() => handleGenderChange("male")}
              className={cn(
                "rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                activeGender === "male" 
                  ? "bg-primary text-white shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isStudioMode ? "Male" : "M"}
            </button>
          </div>

          {/* Split View Button - Only in Studio Mode */}
          <div 
            className={cn(
              "absolute top-3 right-3 transition-all duration-300",
              isStudioMode ? "opacity-100" : "opacity-0 pointer-events-none",
              tour.isHighlighted('category-tabs') ? "z-50" : "z-10" // actually this button is gone in split view? Wait, split view button OPENS split view.
                                                                     // 'category-tabs' step requires split view, so this button is likely hidden.
                                                                     // But if we wanted to highlight it? No, tour steps are sequential.
            )}
          >
            <IconButton
              tone="ghost"
              size="xs"
              aria-label="Open split view"
              className="rounded-lg bg-card/80 backdrop-blur-sm"
              onClick={handleOpenSplitView}
            >
              <Columns2 className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>

          {/* Mannequin - with per-item animations for undo/redo */}
          <div className={cn(
            "absolute left-1/2 top-1/2 flex h-[440px] w-[360px] -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-all duration-300",
             tour.isHighlighted('mannequin') ? "z-50 scale-[1.02]" : "z-0"
          )}>
            <OutfitInspirationTile
              preset="hero"
              renderedItems={renderedItems}
              avatarGender={activeGender}
              avatarHeightCm={170}
              showTitle={false}
              showChips={false}
              showSaveButton={false}
              onItemSelect={handleMannequinItemClick}
              cardClassName="h-full w-full object-contain"
              animatingZone={animatingZone}
              onAvatarReady={setAvatarReady}
            />
            {/* Only show hair when avatar is fully loaded to prevent hair appearing before outfit */}
            {avatarReady && activeGender === "female" && (
              <img
                src="/female_hair.png"
                alt=""
                className="absolute top-[-1%] left-1/2 z-10 w-[23%] -translate-x-1/2 object-contain pointer-events-none"
              />
            )}
            {avatarReady && activeGender === "male" && (
              <img
                src="/male_hair.png"
                alt=""
                className="absolute top-[-3.5%] left-[49.6%] z-10 w-[16%] -translate-x-1/2 object-contain pointer-events-none"
              />
            )}
          </div>

          {/* Control Buttons - Only in Studio Mode */}
          <div 
            className={cn(
              "absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-center justify-center gap-3 rounded-xl bg-card/50 px-2 py-3 transition-opacity duration-300",
              isStudioMode ? "opacity-100" : "opacity-0 pointer-events-none",
              (tour.isHighlighted('history') || tour.isHighlighted('share')) ? "z-50" : "z-10"
            )}
          >
            <IconButton
              tone="ghost"
              size="sm"
              aria-label="Information"
              onClick={handleInfo}
              className="text-muted-foreground hover:text-foreground h-8 w-8"
            >
              <Info className="h-3.5 w-3.5" />
            </IconButton>



            <div className={cn(
              "flex flex-col gap-3 rounded-xl transition-all duration-300",
              tour.isHighlighted('history') && "z-50 relative bg-card shadow-lg ring-2 ring-primary/20 scale-110 p-1 -m-1"
            )}>
              <IconButton
                tone="ghost"
                size="sm"
                aria-label="Undo"
                onClick={handleUndo}
                disabled={!canUndo}
                className={cn(
                  "text-muted-foreground hover:text-foreground h-8 w-8",
                  !canUndo && "opacity-30 cursor-not-allowed"
                )}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                tone="ghost"
                size="sm"
                aria-label="Redo"
                onClick={handleRedo}
                disabled={!canRedo}
                className={cn(
                  "text-muted-foreground hover:text-foreground h-8 w-8",
                  !canRedo && "opacity-30 cursor-not-allowed"
                )}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
            
            <IconButton
              tone="ghost"
              size="sm"
              aria-label="Share"
              onClick={handleShare}
              className={cn(
                "text-muted-foreground hover:text-foreground h-8 w-8 transition-all duration-300",
                tour.isHighlighted('share') && "z-50 relative bg-background/80 shadow-lg ring-2 ring-primary/20 scale-110"
              )}
            >
              <Share className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </section>

        {/* Right Panel - Product Alternatives Grid */}
        <section 
          className={cn(
            "relative flex h-full flex-col overflow-hidden transition-all duration-300 ease-out",
            isStudioMode ? "w-0 opacity-0" : "w-[45%] opacity-100"
          )}
        >
          {/* Category tabs - all 4 icons evenly spaced */}
          <div className={cn(
            "flex h-[48px] items-center justify-between px-3 pt-1 bg-card/30 transition-all duration-300 relative",
             tour.isHighlighted('category-tabs') ? "z-50 bg-card rounded-t-xl" : ""
          )}>
            {categories.map((cat) => {
              const Icon = cat.icon
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleSlotChange(cat.id)}
                  aria-label={cat.label}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                    dressActive && cat.id === "bottom" && "opacity-40 cursor-not-allowed",
                    activeSlot === cat.id && !(dressActive && cat.id === "bottom")
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              )
            })}
            {/* Cross button */}
            <button
              type="button"
              onClick={handleBackToStudio}
              aria-label="Close split view"
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground relative duration-300",
                tour.isHighlighted('close-split') && "z-50 bg-card shadow-lg ring-2 ring-primary/20 scale-110"
              )}
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          <div className={cn(
            "flex-1 overflow-y-auto p-1 transition-all duration-300",
            tour.isHighlighted('product-grid') ? "z-50 bg-background relative shadow-inner" : ""
          )}>
            <div className="grid grid-cols-2 gap-1">
              {alternatives.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleProductSelect(product)}
                  className={cn(
                    "group rounded-lg border bg-card/50 overflow-hidden transition-all",
                    outfit[product.type].id === product.id
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-transparent hover:border-border hover:bg-card"
                  )}
                >
                  {/* Fixed aspect ratio for consistent card sizes */}
                  <div className="aspect-[4/5] flex items-center justify-center bg-muted/20">
                    <img
                      src={product.imageUrl}
                      alt={product.productName}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
      
      <MiniStudioTour tour={tour} />
    </div>
  )
}
