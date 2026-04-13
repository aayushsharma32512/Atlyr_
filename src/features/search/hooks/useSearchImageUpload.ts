import { useMutation } from "@tanstack/react-query"

import { searchKeys } from "@/features/search/queryKeys"
import { uploadSearchImage } from "@/services/storage/publicFilesService"

export function useSearchImageUpload() {
  return useMutation({
    mutationKey: searchKeys.uploadImage(),
    mutationFn: (file: File) => uploadSearchImage({ file }),
  })
}
