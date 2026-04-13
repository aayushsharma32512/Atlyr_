import { Navigate, Route, Routes } from "react-router-dom"

import { StudioLayout } from "@/features/studio/StudioLayout"
import { ProductPageView } from "@/features/studio/ProductPageScreen"
import { StudioAlternativesView } from "@/features/studio/StudioAlternativesScreen"
import { StudioScreenView } from "@/features/studio/StudioScreen"
import { StudioScrollUpView } from "@/features/studio/StudioScrollUpScreen"
import { OutfitSuggestionsView } from "@/features/studio/OutfitSuggestionsScreen"
import { SimilarItemsView } from "@/features/studio/SimilarItemsScreen"

export default function StudioRoutes() {
  return (
    <Routes>
      <Route element={<StudioLayout />}>
        <Route index element={<StudioScreenView />} />
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

