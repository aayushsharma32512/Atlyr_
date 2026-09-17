import { useEffect, useMemo, useRef, useState } from "react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Chip } from "@/design-system/primitives/chip"
import { ProductTile } from "@/design-system/primitives/product-tile"
import type { ProductGenderFilter, ProductTypeFilter } from "@/services/admin-inventory/productRemovalService"
import { useProductsBrowse } from "../hooks/useProductsBrowse"
import { ProductDeleteSheet } from "./ProductDeleteSheet"

export interface AdminProductItem {
    id: string
    title: string
    imageSrc: string | null
    brand: string
    priceLabel: string
    type: string | null
}

const BROWSE_PRICE_FORMATTER = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
})

const SEARCH_DEBOUNCE_MS = 300

const GENDER_FILTERS: { value: ProductGenderFilter | "all"; label: string }[] = [
    { value: "all", label: "All" },
    { value: "female", label: "Female" },
    { value: "male", label: "Male" },
    { value: "unisex", label: "Unisex" },
]

const TYPE_FILTERS: { value: ProductTypeFilter | "all"; label: string }[] = [
    { value: "all", label: "All" },
    { value: "top", label: "Top" },
    { value: "bottom", label: "Bottom" },
    { value: "shoes", label: "Shoes" },
]

export function ProductSearchGrid() {
    const [inputValue, setInputValue] = useState("")
    const [debouncedQuery, setDebouncedQuery] = useState("")
    const [gender, setGender] = useState<ProductGenderFilter | "all">("all")
    const [type, setType] = useState<ProductTypeFilter | "all">("all")
    const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
    const [selectedProduct, setSelectedProduct] = useState<AdminProductItem | null>(null)
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(inputValue.trim()), SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [inputValue])

    const browse = useProductsBrowse({ q: debouncedQuery, gender, type })
    const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = browse

    const items: AdminProductItem[] = useMemo(
        () =>
            (data?.pages ?? []).flatMap((page) =>
                page.rows.map((product) => ({
                    id: product.id,
                    title: product.product_name || product.brand,
                    imageSrc: product.thumbnail_url ?? product.image_url ?? null,
                    brand: product.brand,
                    priceLabel: BROWSE_PRICE_FORMATTER.format(product.price),
                    type: product.type,
                })),
            ),
        [data],
    )

    const visibleItems = items.filter((item) => !removedIds.has(item.id))

    useEffect(() => {
        const node = sentinelRef.current
        if (!node || !hasNextPage) return

        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting && !isFetchingNextPage) {
                fetchNextPage()
            }
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    const handleDeleted = (productId: string) => {
        setRemovedIds((prev) => new Set(prev).add(productId))
        setSelectedProduct(null)
    }

    return (
        <div className="flex flex-col gap-4">
            <Input
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder="Search products…"
            />

            <div className="flex flex-wrap gap-2">
                {GENDER_FILTERS.map((filter) => (
                    <Chip
                        key={filter.value}
                        label={filter.label}
                        active={gender === filter.value}
                        onClick={() => setGender(filter.value)}
                    />
                ))}
            </div>

            <div className="flex flex-wrap gap-2">
                {TYPE_FILTERS.map((filter) => (
                    <Chip
                        key={filter.value}
                        label={filter.label}
                        active={type === filter.value}
                        onClick={() => setType(filter.value)}
                    />
                ))}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <LoadingSpinner />
                </div>
            ) : visibleItems.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                    {debouncedQuery ? "No products match that search." : "No products found."}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {visibleItems.map((item) => (
                            <ProductTile
                                key={item.id}
                                title={item.title}
                                imageSrc={item.imageSrc}
                                brand={item.brand}
                                price={item.priceLabel}
                                mark={false}
                                onSelect={() => setSelectedProduct(item)}
                            />
                        ))}
                    </div>

                    <div ref={sentinelRef} className="flex items-center justify-center py-4">
                        {hasNextPage ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={isFetchingNextPage}
                                onClick={() => fetchNextPage()}
                            >
                                {isFetchingNextPage ? "Loading…" : "Load more"}
                            </Button>
                        ) : null}
                    </div>
                </>
            )}

            <ProductDeleteSheet
                product={selectedProduct}
                onClose={() => setSelectedProduct(null)}
                onDeleted={handleDeleted}
            />
        </div>
    )
}
