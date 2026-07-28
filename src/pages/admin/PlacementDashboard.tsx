import { useMemo, useState } from 'react'
import { AppShellLayout } from '@/layouts/AppShellLayout'
import { PhotoCard } from '@/components/ingestion-automated/PhotoCard'
import { ProductPlacementEditor, type PlacementProduct } from '@/components/ingestion-automated/PlacementMeshEditor'
import { useProducts } from '@/hooks/useProducts'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// The catalog row shape we read for placement. useProducts selects '*', so the placement_* columns
// are present at runtime even though the shared Product type predates them.
type CatalogRow = PlacementProduct & {
  brand?: string | null
  type_category?: string | null
  created_at?: string
}

const GENDERS = ['male', 'female', 'unisex'] as const

export default function PlacementDashboard() {
  const [productId, setProductId] = useState('')
  const [gender, setGender] = useState<'' | 'male' | 'female' | 'unisex'>('')
  const [category, setCategory] = useState('')
  const [createdAfter, setCreatedAfter] = useState('') // yyyy-mm-dd
  const [createdBefore, setCreatedBefore] = useState('')
  const [openProduct, setOpenProduct] = useState<CatalogRow | null>(null)

  // Memoize the array/derived args: useProducts refetches whenever these change *identity*, so a
  // fresh `[gender]` array every render would loop forever (fetch → render → new array → fetch …).
  const gendersArg = useMemo<Array<"male" | "female" | "unisex"> | undefined>(
    () => (gender ? [gender] : undefined),
    [gender],
  )
  const typeCategoriesArg = useMemo<string[] | undefined>(
    () => (category ? [category] : undefined),
    [category],
  )
  const createdAfterArg = useMemo(
    () => (createdAfter ? new Date(createdAfter).toISOString() : undefined),
    [createdAfter],
  )
  const createdBeforeArg = useMemo(
    () => (createdBefore ? new Date(createdBefore + "T23:59:59").toISOString() : undefined),
    [createdBefore],
  )
  const productIdArg = useMemo(() => productId.trim() || undefined, [productId])

  const { products, loading, error, refetch } = useProducts({
    // Only what the tiles + editor need — skips vector_embedding / big JSONB and the exact count.
    columns: 'id, product_name, brand, image_url, gender, type_category, placement, created_at',
    productId: productIdArg,
    genders: gendersArg,
    typeCategories: typeCategoriesArg,
    createdAfter: createdAfterArg,
    createdBefore: createdBeforeArg,
  })

  const rows = products as unknown as CatalogRow[]

  // Category options derived from the loaded rows.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.type_category) set.add(r.type_category)
    return Array.from(set).sort()
  }, [rows])

  const clearFilters = () => {
    setProductId(''); setGender(''); setCategory(''); setCreatedAfter(''); setCreatedBefore('')
  }

  const isPlaced = (r: CatalogRow) => !!r.placement && Object.keys(r.placement).length > 0
  const placedCount = rows.filter(isPlaced).length

  return (
    <AppShellLayout>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Filter bar */}
        <div className="shrink-0 border-b border-border bg-background/95 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Product ID</label>
              <Input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="exact id" className="h-8 w-56 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value as typeof gender)} className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs">
                <option value="">All</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs">
                <option value="">All</option>
                {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">From</label>
              <Input type="date" value={createdAfter} onChange={(e) => setCreatedAfter(e.target.value)} className="h-8 w-36 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">To</label>
              <Input type="date" value={createdBefore} onChange={(e) => setCreatedBefore(e.target.value)} className="h-8 w-36 text-xs" />
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={clearFilters}>Clear</Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={refetch}>Refresh</Button>
            <div className="ml-auto text-[11px] text-muted-foreground">
              {loading ? 'Loading…' : `${rows.length} products · ${placedCount} placed`}
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">No products match these filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {rows.map((r) => {
                const placed = isPlaced(r)
                return (
                  <PhotoCard
                    key={r.id}
                    label={r.product_name ?? r.id.slice(0, 8)}
                    state="available"
                    url={r.image_url}
                    size="lg"
                    badge={placed ? 'Placed' : 'Needs placement'}
                    note={[r.brand, r.gender, r.type_category].filter(Boolean).join(' · ')}
                    onExpand={() => setOpenProduct(r)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      <ProductPlacementEditor
        product={openProduct}
        open={openProduct !== null}
        onOpenChange={(o) => { if (!o) setOpenProduct(null) }}
        onSaved={refetch}
      />
    </AppShellLayout>
  )
}
