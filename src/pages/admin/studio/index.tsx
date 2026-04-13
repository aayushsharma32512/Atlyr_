import { Navigate, Route, Routes, useSearchParams, Link } from "react-router-dom"
import { useEffect, useRef } from "react"
import { User, Users, Loader2, ArrowLeft } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { studioKeys } from "@/features/studio/queryKeys"

import { StudioLayout } from "@/features/studio/StudioLayout"
import { StudioScreenView } from "@/features/studio/StudioScreen"
import { StudioAlternativesView } from "@/features/studio/StudioAlternativesScreen"
import { AdminGenderProvider } from "@/features/admin/providers/AdminGenderContext"
import { useAdminGender } from "@/features/admin/providers/AdminGenderContext"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useStarterOutfit } from "@/features/outfits/hooks/useStarterOutfit"

function GenderToggle({ onGenderChange }: { onGenderChange: (gender: "male" | "female") => void }) {
  const { selectedGender, setSelectedGender } = useAdminGender()
  
  const handleGenderClick = (gender: "male" | "female") => {
    if (gender !== selectedGender) {
      setSelectedGender(gender)
      onGenderChange(gender)
    }
  }
  
  return (
    <div className="fixed top-20 left-4 z-50 flex gap-1 rounded-full bg-card border border-border p-1 shadow-lg">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleGenderClick("female")}
        className={cn(
          "rounded-full px-3 py-1 text-xs font-medium transition-colors",
          selectedGender === "female" 
            ? "bg-pink-500/20 text-pink-600 hover:bg-pink-500/30" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <User className="h-3.5 w-3.5 mr-1" />
        Female
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleGenderClick("male")}
        className={cn(
          "rounded-full px-3 py-1 text-xs font-medium transition-colors",
          selectedGender === "male" 
            ? "bg-blue-500/20 text-blue-600 hover:bg-blue-500/30" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Users className="h-3.5 w-3.5 mr-1" />
        Male
      </Button>
    </div>
  )
}

function AdminStudioContent() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { selectedGender, setSelectedGender } = useAdminGender()
  const queryClient = useQueryClient()
  const outfitId = searchParams.get("outfitId")
  const hasLoadedStarter = useRef(false)
  const hasSyncedGender = useRef<string | null>(null)
  const manualGenderOverride = useRef(false)

  // Fetch outfit gender and sync toggle when outfitId is present
  // BUT respect manual gender selection (don't override if user explicitly toggled)
  useEffect(() => {
    async function syncGenderFromOutfit() {
      if (!outfitId || hasSyncedGender.current === outfitId || manualGenderOverride.current) return

      const { supabase } = await import("@/integrations/supabase/client")
      const { data } = await supabase
        .from("outfits")
        .select("gender")
        .eq("id", outfitId)
        .single()

      if (data?.gender === "male" || data?.gender === "female") {
        if (data.gender !== selectedGender) {
          setSelectedGender(data.gender)
          // Clear studio queries to reload with correct gender
          queryClient.removeQueries({ queryKey: studioKeys.all })
        }
      }
      hasSyncedGender.current = outfitId
    }

    syncGenderFromOutfit()
  }, [outfitId, selectedGender, setSelectedGender, queryClient])

  // Use hook to fetch starter outfit (follows architecture rules)
  // Only enabled when: no outfitId in URL AND haven't loaded a starter yet
  const { data: starterOutfitId, isLoading } = useStarterOutfit({
    gender: selectedGender,
    enabled: !outfitId && !hasLoadedStarter.current,
  })

  // Auto-set starter outfit in URL when it loads
  useEffect(() => {
    if (starterOutfitId && !outfitId && !hasLoadedStarter.current) {
      hasLoadedStarter.current = true
      const newParams = new URLSearchParams()
      newParams.set("outfitId", starterOutfitId)
      setSearchParams(newParams, { replace: true })
    }
  }, [starterOutfitId, outfitId, setSearchParams])

  // Clear state when gender changes to trigger new fetch and clean UI
  const handleGenderChange = () => {
    // Mark that user manually toggled gender (don't auto-sync from outfit anymore)
    manualGenderOverride.current = true
    
    // Clear all studio state immediately
    queryClient.clear()
    
    // Always clear URL completely - this will trigger starter outfit fetch for new gender
    setSearchParams(new URLSearchParams(), { replace: true })
    
    // Reset flags to allow starter outfit fetch for the new gender
    hasLoadedStarter.current = false
    hasSyncedGender.current = null
    
    // Routes will remount due to key={selectedGender} change
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const fromEnrichment = searchParams.get("from") === "enrichment"

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <div className="h-14 border-b px-4 flex items-center gap-3">
        {fromEnrichment && (
          <Link
            to="/admin/enrichment"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Enrichments
          </Link>
        )}
        <h1 className="text-lg font-semibold">Admin Studio</h1>
      </div>
      <GenderToggle onGenderChange={handleGenderChange} />
      <Routes key={selectedGender}>
        {/* Key on Routes forces full remount on gender change, clearing all context */}
        <Route element={<StudioLayout />}>
          <Route index element={<StudioScreenView />} />
          <Route path="alternatives" element={<StudioAlternativesView />} />
        </Route>
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </div>
  )
}

export default function AdminStudioRoutes() {
  return (
    <AdminGenderProvider defaultGender="female">
      <AdminStudioContent />
    </AdminGenderProvider>
  )
}

