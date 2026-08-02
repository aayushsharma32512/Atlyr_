import { lazy } from "react"
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom"

import { StudioLayout } from "@/features/studio/StudioLayout"
import { useStudioShareMode } from "@/features/studio/hooks/useStudioShareMode"
import { ProductPageView } from "@/features/studio/ProductPageScreen"
import { StudioAlternativesView } from "@/features/studio/StudioAlternativesScreen"
import { StudioScreenView } from "@/features/studio/StudioScreen"
import { StudioScrollUpView } from "@/features/studio/StudioScrollUpScreen"
import { OutfitSuggestionsView } from "@/features/studio/OutfitSuggestionsScreen"
import { SimilarItemsView } from "@/features/studio/SimilarItemsScreen"

const SharedLookScreen = lazy(() => import("@/features/studio/SharedLookScreen"))

function StudioRootLayout() {
  const location = useLocation()
  const { isShareLink } = useStudioShareMode()
  const isShareLanding =
    isShareLink && location.pathname.replace(/\/+$/, "") === "/studio"

  return isShareLanding ? <Outlet /> : <StudioLayout />
}

function StudioEntry() {
  const { isShareLink } = useStudioShareMode()
  return isShareLink ? <SharedLookScreen /> : <StudioScreenView />
}

export default function StudioRoutes() {
  return (
    <Routes>
      <Route element={<StudioRootLayout />}>
        <Route index element={<StudioEntry />} />
        <Route path="scroll-up" element={<StudioScrollUpView />} />
        <Route path="alternatives" element={<StudioAlternativesView />} />
        <Route path="outfit-suggestions" element={<OutfitSuggestionsView />} />
        <Route path="product/:productId" element={<ProductPageView />} />
        <Route path="similar" element={<SimilarItemsView />} />
      </Route>
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  )
}
