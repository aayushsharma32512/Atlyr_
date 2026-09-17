import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { deleteProduct } from "@/services/admin-inventory/productRemovalService"
import { adminInventoryQueryKeys } from "../queryKeys"

/** Deletes a product and reports how many outfits went with it. */
export function useDeleteProduct() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (productId: string) => deleteProduct(productId),
        onSuccess: (outfitCount) => {
            toast.success(`Deleted · ${outfitCount} outfits removed`)
            queryClient.invalidateQueries({ queryKey: adminInventoryQueryKeys.products() })
        },
        onError: (error: Error) => {
            toast.error(error.message)
        },
    })
}
