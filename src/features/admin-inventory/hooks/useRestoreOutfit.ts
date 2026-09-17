import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { restoreOutfit } from "@/services/admin-inventory/outfitReviewService"
import { adminInventoryQueryKeys } from "../queryKeys"

/** Puts a hidden outfit back in the feed and back in the review queue. */
export function useRestoreOutfit() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (outfitId: string) => restoreOutfit(outfitId),
        onSuccess: () => {
            toast.success("Restored")
            queryClient.invalidateQueries({ queryKey: adminInventoryQueryKeys.outfits() })
        },
        onError: (error: Error) => {
            toast.error(error.message)
        },
    })
}
