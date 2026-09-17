import { AppShellLayout } from "@/layouts/AppShellLayout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProductSearchGrid } from "@/features/admin-inventory/components/ProductSearchGrid"
import { OutfitsBrowseGrid } from "@/features/admin-inventory/components/OutfitsBrowseGrid"

/**
 * Admin tool to cut broken inventory: hard-delete a product (its outfits go
 * with it) or hide a stale/dull outfit from the feed, reversibly.
 */
export default function AdminInventoryDashboard() {
    return (
        <AppShellLayout hideNav>
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
                <div className="text-center">
                    <h1 className="font-display text-2xl font-bold italic text-foreground">
                        <span className="text-violet">Inventory</span> Cleanup
                    </h1>
                    <p className="text-sm italic text-muted-foreground">
                        Cut what does not <span className="text-violet">slay</span>
                    </p>
                </div>

                <Tabs defaultValue="products" className="flex flex-1 flex-col">
                    <TabsList className="mx-auto">
                        <TabsTrigger value="products">Products</TabsTrigger>
                        <TabsTrigger value="outfits">Outfits</TabsTrigger>
                    </TabsList>

                    <TabsContent value="products" className="flex-1">
                        <ProductSearchGrid />
                    </TabsContent>

                    <TabsContent value="outfits" className="flex flex-1 flex-col gap-6">
                        <OutfitsBrowseGrid />
                    </TabsContent>
                </Tabs>
            </div>
        </AppShellLayout>
    )
}
