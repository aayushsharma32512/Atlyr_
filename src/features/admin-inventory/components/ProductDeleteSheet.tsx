import { useEffect, useRef, useState } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useCountOutfitsForProduct } from "../hooks/useCountOutfitsForProduct"
import { useDeleteProduct } from "../hooks/useDeleteProduct"
import type { AdminProductItem } from "./ProductSearchGrid"

interface ProductDeleteSheetProps {
    product: AdminProductItem | null
    onClose: () => void
    onDeleted: (productId: string) => void
}

// Delete is destructive; a tap arms it, a second tap within this window confirms it.
const ARM_TIMEOUT_MS = 4000

export function ProductDeleteSheet({ product, onClose, onDeleted }: ProductDeleteSheetProps) {
    const [armed, setArmed] = useState(false)
    const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const { data: outfitCount, isLoading: countLoading } = useCountOutfitsForProduct(product?.id ?? null)
    const deleteMutation = useDeleteProduct()

    useEffect(() => {
        setArmed(false)
        if (armTimerRef.current) clearTimeout(armTimerRef.current)
    }, [product?.id])

    useEffect(
        () => () => {
            if (armTimerRef.current) clearTimeout(armTimerRef.current)
        },
        [],
    )

    const handleDeleteTap = () => {
        if (!product) return

        if (!armed) {
            setArmed(true)
            armTimerRef.current = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS)
            return
        }

        if (armTimerRef.current) clearTimeout(armTimerRef.current)
        deleteMutation.mutate(product.id, {
            onSuccess: () => onDeleted(product.id),
        })
    }

    return (
        <Sheet
            open={Boolean(product)}
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
        >
            <SheetContent side="bottom" className="mx-auto max-w-sm rounded-t-xl">
                {product ? (
                    <div className="flex flex-col gap-4">
                        <SheetHeader>
                            <SheetTitle>{product.title}</SheetTitle>
                            <SheetDescription>
                                {product.brand}
                                {product.type ? ` · ${product.type}` : ""}
                            </SheetDescription>
                        </SheetHeader>

                        <div className="aspect-square w-full overflow-hidden rounded-lg border border-hairline bg-background">
                            {product.imageSrc ? (
                                <img
                                    src={product.imageSrc}
                                    alt={product.title}
                                    className="h-full w-full object-contain"
                                />
                            ) : null}
                        </div>

                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Price</span>
                            <span className="font-medium text-foreground">{product.priceLabel}</span>
                        </div>

                        <p className="text-sm text-muted-foreground">
                            {countLoading ? "Counting outfits…" : `Deleting removes ${outfitCount ?? 0} outfits`}
                        </p>

                        <Button
                            size="lg"
                            variant="outline"
                            className="border-2 border-violet bg-white text-foreground hover:bg-white active:bg-violet/10"
                            disabled={deleteMutation.isPending}
                            onClick={handleDeleteTap}
                        >
                            {armed ? "Confirm delete" : "Delete product"}
                        </Button>
                    </div>
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
