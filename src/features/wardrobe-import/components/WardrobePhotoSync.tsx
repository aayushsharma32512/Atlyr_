import { useWardrobePhotoImport } from "@/features/wardrobe-import/hooks/useWardrobeBatchImport"
import type { WardrobePhoto } from "@/features/wardrobe-import/types"

/**
 * Keeps one photo's import row polled while the batch is open, so the rail shows
 * every photo's state and not only the one on screen.
 */
export function WardrobePhotoSync({ photo }: { photo: WardrobePhoto }) {
  useWardrobePhotoImport(photo)
  return null
}
