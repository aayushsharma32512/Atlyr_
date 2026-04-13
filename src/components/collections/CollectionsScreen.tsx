import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GenerationsScreen } from '@/components/generations/GenerationsScreen'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { dataTransformers } from '@/utils/dataTransformers'
import type { Outfit } from '@/types'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, MoreVertical, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFavorites } from '@/hooks/useFavorites'
import { formatDistanceToNow } from 'date-fns'
import { OutfitCard } from '@/components/home/OutfitCard'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Collection = {
  slug: string
  label: string
  count: number
  isSystem: boolean
  emoji?: string
  color?: string
}

type OutfitRow = {
  id: string
  name: string
  category: string
  background_id: string
  occasion: {
    id: string
    name: string
    slug: string
    background_url: string
    description: string
  }
  top: any
  bottom: any
  shoes: any
}

const RESERVED = new Set(['favorites', 'generations'])

type CollectionMeta = {
  emoji: string
  color: string
}

const COLOR_SWATCHES = [
  'linear-gradient(135deg, rgba(37, 99, 235, 0.85), rgba(59, 130, 246, 0.75))',
  'linear-gradient(135deg, rgba(236, 72, 153, 0.85), rgba(249, 115, 22, 0.7))',
  'linear-gradient(135deg, rgba(16, 185, 129, 0.85), rgba(56, 189, 248, 0.7))',
  'linear-gradient(135deg, rgba(245, 158, 11, 0.85), rgba(251, 191, 36, 0.7))',
  'linear-gradient(135deg, rgba(129, 140, 248, 0.85), rgba(96, 165, 250, 0.7))'
]

const EMOJI_SWATCHES = ['🌆', '🌴', '💼', '🔥', '🎨', '✨']

const NAME_SUGGESTIONS = ['Weekend Fits', 'Studio Ready', 'After Hours', 'City Staples', 'Soft Power']

const FAVORITES_SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'occasion', label: 'Occasion' }
]

export function CollectionsScreen() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [active, setActive] = useState<{ slug: string; label: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newEmoji, setNewEmoji] = useState<string>(EMOJI_SWATCHES[0])
  const [newColor, setNewColor] = useState<string>(COLOR_SWATCHES[0])
  const [items, setItems] = useState<OutfitRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [collectionMeta, setCollectionMeta] = useState<Record<string, CollectionMeta>>({})
  const [collectionPreviews, setCollectionPreviews] = useState<Record<string, Outfit[]>>({})
  const [pendingManageCollection, setPendingManageCollection] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem('collection-meta-v1')
      const defaults: Record<string, CollectionMeta> = {
        favorites: { emoji: '❤️', color: COLOR_SWATCHES[1] },
        generations: { emoji: '✨', color: COLOR_SWATCHES[4] }
      }
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, CollectionMeta>
        setCollectionMeta({ ...defaults, ...parsed })
      } else {
        setCollectionMeta(defaults)
      }
    } catch {
      // ignore malformed entries
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem('collection-meta-v1', JSON.stringify(collectionMeta))
    } catch {
      // ignore storage errors
    }
  }, [collectionMeta])

  const updateCollectionMeta = (slug: string, meta: Partial<CollectionMeta>) => {
    setCollectionMeta((prev) => {
      const existing = prev[slug] ?? { emoji: '📁', color: 'var(--muted)' }
      return { ...prev, [slug]: { ...existing, ...meta } }
    })
  }

  const cycleCollectionAccent = (slug: string) => {
    const currentMeta = collectionMeta[slug]
    const currentColorIndex = currentMeta ? COLOR_SWATCHES.indexOf(currentMeta.color) : -1
    const nextColor = COLOR_SWATCHES[(Math.max(currentColorIndex, 0) + 1) % COLOR_SWATCHES.length]
    const currentEmojiIndex = currentMeta ? EMOJI_SWATCHES.indexOf(currentMeta.emoji) : -1
    const nextEmoji = EMOJI_SWATCHES[(Math.max(currentEmojiIndex, 0) + 1) % EMOJI_SWATCHES.length]
    updateCollectionMeta(slug, { color: nextColor, emoji: nextEmoji })
  }

  async function loadCollectionPreview(slug: string) {
    if (collectionPreviews[slug] !== undefined || RESERVED.has(slug)) return
    try {
      const { data, error } = await (supabase as any)
        .from('user_favorites')
        .select(`outfit_id, outfits ( id, name, category, background_id, occasion:occasions!occasion(id,name,slug,background_url,description), top:products!outfits_top_id_fkey(*), bottom:products!outfits_bottom_id_fkey(*), shoes:products!outfits_shoes_id_fkey(*) )`)
        .eq('collection_slug', slug)
        .order('created_at', { ascending: false })
        .limit(3)
      if (error) throw new Error(error.message)
      const outfits = (data || [])
        .map((row: any) => row.outfits)
        .filter(Boolean)
        .map((row: any) => dataTransformers.outfit(row))
      setCollectionPreviews((prev) => ({ ...prev, [slug]: outfits }))
    } catch {
      setCollectionPreviews((prev) => ({ ...prev, [slug]: [] }))
    }
  }

  const pinned: Collection[] = useMemo(() => {
    const favoritesMeta = collectionMeta['favorites'] ?? { emoji: '❤️', color: 'rgba(234, 67, 53, 0.15)' }
    const generationsMeta = collectionMeta['generations'] ?? { emoji: '✨', color: 'rgba(99, 102, 241, 0.15)' }
    return [
      {
        slug: 'favorites',
        label: 'Favorites',
        count: collections.find(c => c.slug === 'favorites')?.count ?? 0,
        isSystem: true,
        emoji: favoritesMeta.emoji,
        color: favoritesMeta.color
      },
      {
        slug: 'generations',
        label: 'Generations',
        count: collections.find(c => c.slug === 'generations')?.count ?? 0,
        isSystem: true,
        emoji: generationsMeta.emoji,
        color: generationsMeta.color
      },
    ]
  }, [collections, collectionMeta])

  async function fetchCollections() {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await (supabase as any).rpc('get_user_collections')
      if (error) throw new Error(error.message)
      const rows = (data as any[] | null) || []
      const list: Collection[] = rows.map(r => ({
        slug: r.collection_slug,
        label: r.collection_label,
        count: Number(r.item_count || 0),
        isSystem: !!r.is_system,
      }))
      // Ensure pinned present even if zero
      const ensure = (slug: string, label: string) => {
        if (!list.find(c => c.slug === slug)) list.unshift({ slug, label, count: 0, isSystem: true })
      }
      ensure('favorites','Favorites')
      ensure('generations','Generations')
      const ordered = [
        ...list.filter(c => c.slug === 'favorites' || c.slug === 'generations'),
        ...list.filter(c => !RESERVED.has(c.slug)).sort((a, b) => a.label.localeCompare(b.label))
      ]
      setCollections(ordered)
      ordered
        .filter((c) => !RESERVED.has(c.slug) && c.count > 0)
        .forEach((c) => {
          void loadCollectionPreview(c.slug)
        })
    } catch (e) {
      setError((e as Error).message)
      setCollections([])
    } finally {
      setLoading(false)
    }
  }

  type DetailOptions = { openManage?: boolean }

  async function openDetail(slug: string, label: string, options?: DetailOptions) {
    setActive({ slug, label })
    setView('detail')
    setPendingManageCollection(options?.openManage ? slug : null)
    if (slug === 'generations' || slug === 'favorites') {
      return
    }
    setItemsLoading(true)
    setError(null)
    try {
      const { data, error } = await (supabase as any)
        .from('user_favorites')
        .select(`outfit_id, outfits ( id, name, category, background_id, occasion:occasions!occasion(id,name,slug,background_url,description), top:products!outfits_top_id_fkey(*), bottom:products!outfits_bottom_id_fkey(*), shoes:products!outfits_shoes_id_fkey(*) )`)
        .eq('collection_slug', slug)
      if (error) throw new Error(error.message)
      setItems((data || []).map((r: any) => r.outfits).filter(Boolean))
    } catch (e) {
      setError((e as Error).message)
      setItems([])
    } finally {
      setItemsLoading(false)
    }
  }

  async function removeFromCollection(slug: string, outfitId: string) {
    try {
      await (supabase as any)
        .from('user_favorites')
        .delete()
        .eq('collection_slug', slug)
        .eq('outfit_id', outfitId)
      // refresh detail
      if (active) await openDetail(active.slug, active.label)
      await fetchCollections()
    } catch {
      // no-op
    }
  }

  function slugify(name: string) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  async function createCollection(meta?: CollectionMeta) {
    const label = newName.trim()
    const slug = slugify(label)
    if (!slug || RESERVED.has(slug)) return
    setCreating(true)
    setError(null)
    try {
      const { error } = await (supabase as any).rpc('manage_collection', { p_operation: 'create', p_collection_slug: slug, p_collection_label: label })
      if (error) throw new Error((error as any).message || 'Failed to create')
      setNewName('')
      setNewEmoji(EMOJI_SWATCHES[0])
      setNewColor(COLOR_SWATCHES[0])
      if (meta) updateCollectionMeta(slug, meta)
      await fetchCollections()
      // Optimistically ensure it appears even if empty
      setCollections((prev) => {
        if (prev.find((c) => c.slug === slug)) return prev
        return [...prev, { slug, label, count: 0, isSystem: false, emoji: meta?.emoji, color: meta?.color }]
      })
      setCollectionPreviews((prev) => ({ ...prev, [slug]: [] }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    fetchCollections()
  }, [])

  if (view === 'detail' && active) {
    const activeCollection = collections.find((c) => c.slug === active.slug)
    const meta = collectionMeta[active.slug]

    if (active.slug === 'generations') {
      return (
        <GenerationsDetailView
          onBack={() => setView('list')}
          count={activeCollection?.count ?? 0}
          accentColor={meta?.color}
          emoji={meta?.emoji ?? '✨'}
        />
      )
    }

    if (active.slug === 'favorites') {
      return (
        <FavoritesDetailView
          onBack={() => setView('list')}
          count={activeCollection?.count ?? 0}
        />
      )
    }

    return (
      <CustomCollectionDetailView
        onBack={() => {
          setView('list')
          setPendingManageCollection(null)
        }}
        collection={{
          slug: active.slug,
          label: active.label,
          count: activeCollection?.count ?? items.length,
          isSystem: false,
          emoji: meta?.emoji,
          color: meta?.color
        }}
        items={items}
        isLoading={itemsLoading}
        error={error}
        onRemove={(outfitId) => removeFromCollection(active.slug, outfitId)}
        onRefresh={() => openDetail(active.slug, active.label)}
        onCustomizeMeta={(nextMeta) => updateCollectionMeta(active.slug, nextMeta)}
        initialManageOpen={pendingManageCollection === active.slug}
        onManageOpenChange={(open) => {
          if (!open && pendingManageCollection === active.slug) {
            setPendingManageCollection(null)
          }
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Collections</h3>
          <p className="text-sm text-muted-foreground">Pinned system collections and your lookbooks</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>+ New</Button>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">{error}</div>}

      {/* Pinned */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Pinned</span>
        </div>
        <div className="space-y-3">
          {pinned.map((c) => (
            <Card
              key={c.slug}
              className="overflow-hidden rounded-2xl border border-border/30 bg-card/80 shadow-sm"
              onClick={() => openDetail(c.slug, c.label)}
            >
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
                    style={{ background: c.color || COLOR_SWATCHES[4] }}
                  >
                    {c.emoji ?? '✨'}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{c.label}</div>
                    <p className="text-xs text-muted-foreground">
                      {c.slug === 'favorites'
                        ? 'Curated fits ready to revisit.'
                        : 'AI looks and remixes waiting in queue.'}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="rounded-full bg-muted text-xs">
                  {c.count}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* User collections */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your lookbooks</div>
            <p className="text-sm text-muted-foreground">Tap to open, curate, and remix.</p>
          </div>
          <div className="text-xs text-muted-foreground">
            {collections.filter(c => !RESERVED.has(c.slug)).length} saved
          </div>
        </div>

        <div className="space-y-3">
          {collections.filter(c => !RESERVED.has(c.slug)).map(c => {
            const meta = collectionMeta[c.slug] ?? { emoji: '📁', color: COLOR_SWATCHES[0] }
            return (
              <Card
                key={c.slug}
                className="cursor-pointer overflow-hidden rounded-3xl border border-border/40 bg-card/80 shadow-sm"
                onClick={() => openDetail(c.slug, c.label)}
              >
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
                      style={{ background: meta.color }}
                    >
                      {meta.emoji}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{c.label}</div>
                      <p className="text-xs text-muted-foreground">{c.count} look{c.count === 1 ? '' : 's'} saved</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-full"
                      onClick={(event) => {
                        event.stopPropagation()
                        cycleCollectionAccent(c.slug)
                      }}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-full"
                      onClick={(event) => {
                        event.stopPropagation()
                        openDetail(c.slug, c.label, { openManage: true })
                      }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {collections.filter(c => !RESERVED.has(c.slug)).length === 0 && (
            <div className="flex h-32 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 text-sm text-muted-foreground">
              No lookbooks yet. Tap “New” to start.
            </div>
          )}
        </div>
      </div>

      <Sheet open={showCreate} onOpenChange={setShowCreate}>
        <SheetContent side="bottom" className="h-[60vh]">
          <SheetHeader>
            <SheetTitle>Create collection</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div
              className="relative flex items-center justify-between rounded-2xl border border-border/60 px-4 py-5"
              style={{ background: newColor }}
            >
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-black/10 via-transparent to-black/30" />
              <span className="relative text-4xl drop-shadow">{newEmoji}</span>
              <div className="relative flex items-center gap-2">
                {COLOR_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      'h-8 w-8 rounded-full border border-white/20 shadow-md',
                      newColor === color && 'ring-2 ring-white'
                    )}
                    style={{ background: color }}
                    onClick={() => setNewColor(color)}
                  />
                ))}
              </div>
              <div className="relative flex items-center gap-2">
                {EMOJI_SWATCHES.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-lg',
                      newEmoji === emoji && 'ring-2 ring-white'
                    )}
                    onClick={() => setNewEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Collection name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Streetwear" />
            </div>
            <div className="flex flex-wrap gap-2">
              {NAME_SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setNewName(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button className="flex-1" disabled={creating || !newName.trim() || RESERVED.has(slugify(newName))}
                onClick={async () => {
                  await createCollection({ emoji: newEmoji, color: newColor })
                  setShowCreate(false)
                }}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

type GenerationsDetailViewProps = {
  onBack: () => void
  count: number
  accentColor?: string
  emoji: string
}

function GenerationsDetailView({ onBack, count, accentColor, emoji }: GenerationsDetailViewProps) {
  const dotCount = Math.min(Math.max(count, 3), 8)

  return (
    <div className="space-y-4 pb-16">
      <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-background/60 shadow-lg shadow-black/5">
        <div className="absolute inset-0" style={{ background: accentColor ?? COLOR_SWATCHES[4] }} />
        <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-transparent to-black/40" />
        <div className="relative space-y-6 p-5 text-white">
          <div className="flex items-center justify-between">
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-full border border-white/20 bg-black/20 text-white"
              onClick={onBack}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-xs font-medium uppercase tracking-[0.3em] text-white/70">Generations</div>
            <Badge variant="secondary" className="bg-white/15 text-white">
              {count}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-5xl drop-shadow-sm">{emoji}</span>
              <div>
                <div className="text-lg font-semibold leading-tight">Virtual try-ons at your fingertips</div>
                <p className="text-xs text-white/70">Swipe through ready looks or check progress below.</p>
              </div>
            </div>
            <div className="hidden flex-col items-end gap-2 sm:flex">
              <span className="text-[0.65rem] uppercase tracking-[0.3em] text-white/60">Progress</span>
              <div className="flex gap-1">
                {Array.from({ length: dotCount }).map((_, idx) => (
                  <span
                    key={idx}
                    className="h-2 w-6 rounded-full bg-white/70"
                    style={{ opacity: 1 - idx * 0.1 }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <GenerationsScreen />
    </div>
  )
}

type FavoritesDetailViewProps = {
  onBack: () => void
  count: number
}

function FavoritesDetailView({ onBack, count }: FavoritesDetailViewProps) {
  const { favorites, loading, removeFavorite } = useFavorites()
  const [selectedFilter, setSelectedFilter] = useState<string>('all')
  const [selectedSort, setSelectedSort] = useState<'newest' | 'oldest' | 'occasion'>('newest')

  const filterOptions = useMemo(() => {
    const base = [{ id: 'all', label: 'All', count: favorites.length }]
    const categoryGroups = favorites.reduce<Record<string, number>>((acc, outfit) => {
      const key = outfit.category ?? 'other'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
    const asOptions = Object.entries(categoryGroups)
      .map(([slug, value]) => ({ id: slug, label: slug.replace(/-/g, ' '), count: value }))
    return base.concat(asOptions)
  }, [favorites])

  const heroFavorites = favorites.slice(0, 3)

  const filteredFavorites = useMemo(() => {
    if (selectedFilter === 'all') return favorites
    return favorites.filter((outfit) => outfit.category === selectedFilter)
  }, [favorites, selectedFilter])

  const sortedFavorites = useMemo(() => {
    const copy = [...filteredFavorites]
    switch (selectedSort) {
      case 'oldest':
        return copy.sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
      case 'occasion':
        return copy.sort((a, b) => (a.occasion?.name || '').localeCompare(b.occasion?.name || ''))
      case 'newest':
      default:
        return copy.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    }
  }, [filteredFavorites, selectedSort])

  return (
    <div className="pb-24">
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-background/60 shadow-lg shadow-black/5">
        <div className="absolute inset-0" style={{ background: COLOR_SWATCHES[1] }} />
        <div className="absolute inset-0 bg-gradient-to-br from-black/30 via-transparent to-black/40" />
        <div className="relative space-y-6 p-5 text-white">
          <div className="flex items-center justify-between">
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-full border border-white/20 bg-black/20 text-white"
              onClick={onBack}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-xs font-medium uppercase tracking-[0.3em] text-white/70">Favorites</div>
            <Badge variant="secondary" className="bg-white/15 text-white">
              {count}
            </Badge>
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {heroFavorites.map((outfit, idx) => (
                <div
                  key={outfit.id}
                  className={cn(
                    'relative h-20 w-16 overflow-hidden rounded-xl border border-white/20 bg-white/30 shadow-md backdrop-blur',
                    idx > 0 && '-ml-6'
                  )}
                >
                  <img
                    src={outfit.items[0]?.imageUrl || '/placeholder.png'}
                    alt={outfit.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
              <div>
                <div className="text-lg font-semibold leading-tight">Looks you keep coming back to</div>
                <p className="text-xs text-white/70">
                  {favorites[0]?.created_at
                    ? `Last added ${formatDistanceToNow(new Date(favorites[0].created_at), { addSuffix: true })}`
                    : 'Add a look to see activity here'}
                </p>
              </div>
            </div>
            <div>
              <Select value={selectedFilter} onValueChange={(value) => setSelectedFilter(value)}>
                <SelectTrigger className="w-full rounded-full border-white/30 bg-white/20 text-left text-white placeholder:text-white/70">
                  <SelectValue placeholder="Filter favorites" />
                </SelectTrigger>
                <SelectContent>
                  {filterOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label} ({option.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {FAVORITES_SORT_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  size="sm"
                  variant={selectedSort === option.id ? 'default' : 'secondary'}
                  className="rounded-full bg-white/20 backdrop-blur"
                  onClick={() => setSelectedSort(option.id as typeof selectedSort)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {loading && <div className="text-sm text-muted-foreground">Loading your favorites…</div>}
        {!loading && sortedFavorites.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
            No favorites here yet. Tap the heart icon on any outfit to save it.
          </div>
        )}
        <div className="space-y-6">
          {sortedFavorites.map((outfit) => (
            <div key={outfit.id} className="space-y-3">
              <OutfitCard
                outfit={outfit}
                onClick={() => {
                  const evt = new CustomEvent('navigateToStudio', { detail: { outfit } })
                  window.dispatchEvent(evt)
                }}
                onFavoriteToggle={() => removeFavorite(outfit.id)}
                isFavorite
                maxCardWidth={360}
                className="shadow-lg shadow-primary/10"
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    const evt = new CustomEvent('navigateToStudio', { detail: { outfit } })
                    window.dispatchEvent(evt)
                  }}
                >
                  Open in Studio
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => removeFavorite(outfit.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

type CustomCollectionDetailViewProps = {
  onBack: () => void
  collection: Collection
  items: OutfitRow[]
  isLoading: boolean
  error: string | null
  onRemove: (outfitId: string) => void
  onRefresh: () => void
  onCustomizeMeta: (meta: Partial<CollectionMeta>) => void
  initialManageOpen?: boolean
  onManageOpenChange?: (open: boolean) => void
}

function CustomCollectionDetailView({
  onBack,
  collection,
  items,
  isLoading,
  error,
  onRemove,
  onRefresh,
  onCustomizeMeta,
  initialManageOpen = false,
  onManageOpenChange
}: CustomCollectionDetailViewProps) {
  const [manageOpen, setManageOpen] = useState(initialManageOpen)
  const [accentOpen, setAccentOpen] = useState(false)

  const outfits = useMemo(() => items.map((outfit) => dataTransformers.outfit(outfit as any)), [items])
  const accent = collection.color ?? COLOR_SWATCHES[0]

  useEffect(() => {
    if (initialManageOpen) {
      setManageOpen(true)
    }
  }, [initialManageOpen])

  return (
    <div className="pb-24">
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-background/60 shadow-lg shadow-black/5">
        <div className="absolute inset-0" style={{ background: accent }} />
        <div className="absolute inset-0 bg-gradient-to-br from-black/25 via-transparent to-black/40" />
        <div className="relative space-y-6 p-5 text-white">
          <div className="flex items-center justify-between">
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-full border border-white/20 bg-black/20 text-white"
              onClick={onBack}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full bg-white/20 text-white"
                onClick={() => setAccentOpen(true)}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                Personalize
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-full bg-white/20 text-white"
                onClick={() => {
                  setManageOpen(true)
                  onManageOpenChange?.(true)
                }}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-3">
              <span className="text-5xl drop-shadow-sm">{collection.emoji ?? '📁'}</span>
              <div>
                <div className="text-lg font-semibold leading-tight">{collection.label}</div>
                <p className="text-xs text-white/70">{collection.count} look{collection.count === 1 ? '' : 's'} curated</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {isLoading && <div className="text-sm text-muted-foreground">Loading looks…</div>}
        {error && <div className="text-sm text-red-500">{error}</div>}
        {!isLoading && outfits.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
            Nothing pinned yet. Tap “Add look” to start building this lookbook.
          </div>
        )}

        <div className="space-y-6">
          {outfits.map((outfit) => (
            <div key={outfit.id} className="space-y-3">
              <OutfitCard
                outfit={outfit}
                onClick={() => {
                  const evt = new CustomEvent('navigateToStudio', { detail: { outfit } })
                  window.dispatchEvent(evt)
                }}
                maxCardWidth={360}
                className="shadow-lg shadow-primary/10"
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    const evt = new CustomEvent('navigateToStudio', { detail: { outfit } })
                    window.dispatchEvent(evt)
                  }}
                >
                  Open in Studio
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => onRemove(outfit.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="sticky z-20 flex w-full justify-center px-4"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <Button
          className="w-full max-w-md rounded-full shadow-lg shadow-primary/30"
          onClick={() => window.dispatchEvent(new Event('navigateToHome'))}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add look
        </Button>
      </div>

      <Sheet open={manageOpen} onOpenChange={(open) => {
        setManageOpen(open)
        onManageOpenChange?.(open)
      }}>
        <SheetContent side="bottom" className="h-[45vh]">
          <SheetHeader>
            <SheetTitle>Manage lookbook</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => {
                setManageOpen(false)
                const evt = new CustomEvent('collections:reorder', { detail: { slug: collection.slug } })
                window.dispatchEvent(evt)
              }}
            >
              Reorder looks (coming soon)
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => {
                setManageOpen(false)
                onRefresh()
              }}
            >
              Refresh collection
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={accentOpen} onOpenChange={setAccentOpen}>
        <SheetContent side="bottom" className="h-[45vh]">
          <SheetHeader>
            <SheetTitle>Personalize lookbook</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label className="text-xs">Choose an emoji</Label>
              <div className="mt-2 flex gap-2">
                {EMOJI_SWATCHES.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-muted text-lg',
                      collection.emoji === emoji && 'ring-2 ring-primary'
                    )}
                    onClick={() => onCustomizeMeta({ emoji })}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Accent palette</Label>
              <div className="mt-2 grid grid-cols-3 gap-3">
                {COLOR_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      'h-14 rounded-xl border border-border/60 shadow-sm',
                      collection.color === color && 'ring-2 ring-primary'
                    )}
                    style={{ background: color }}
                    onClick={() => onCustomizeMeta({ color })}
                  />
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
