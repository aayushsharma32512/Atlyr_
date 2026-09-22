import { WardrobeImportScreen } from "@/features/wardrobe-import/WardrobeImportScreen"
import { WardrobeBatchProvider } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"

export default function WardrobeImportPage() {
  return (
    <WardrobeBatchProvider>
      <WardrobeImportScreen />
    </WardrobeBatchProvider>
  )
}
