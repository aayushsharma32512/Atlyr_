import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { OutfitCard } from '@/components/home/OutfitCard'
import { ChevronLeft, ChevronRight, Download, Trash2, Eye } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

type GenerationRow = {
  id: string
  user_id: string
  storage_path: string | null
  outfit_id: string | null
  status: 'queued' | 'generating' | 'ready' | 'failed'
  created_at?: string
}

export function GenerationsScreen() {
  const [tab, setTab] = useState<'images' | 'outfits'>('images')
  const [items, setItems] = useState<GenerationRow[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [viewer, setViewer] = useState<{ index: number; id: string; url: string; outfitId: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [outfits, setOutfits] = useState<any[]>([])
  const [outfitsLoading, setOutfitsLoading] = useState(false)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | GenerationRow['status']>('all')

  const pageSize = 24

  async function fetchPage(p: number) {
    setLoading(true)
    setError(null)
    try {
      const from = p * pageSize
      const to = from + pageSize - 1
      const { data, error } = await (supabase as any)
        .from('user_generations')
        .select('id, user_id, storage_path, outfit_id, status, created_at')
        .order('created_at', { ascending: false })
        .range(from, to)
      if (error) throw new Error(error.message)
      setItems((data as any[]) || [])
    } catch (e) {
      setError((e as Error).message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  async function loadOutfits() {
    setOutfitsLoading(true)
    try {
      const { data, error } = await (supabase as any)
        .from('user_favorites')
        .select(`outfit_id, outfits ( id, name, category, background_id, occasion:occasions!occasion(id,name,slug,background_url,description), top:products!outfits_top_id_fkey(*), bottom:products!outfits_bottom_id_fkey(*), shoes:products!outfits_shoes_id_fkey(*) )`)
        .eq('collection_slug', 'generations')
      if (error) throw new Error(error.message)
      const { dataTransformers } = await import('@/utils/dataTransformers')
      const outs = (data || [])
        .map((r: any) => r.outfits)
        .filter(Boolean)
        .map((row: any) => dataTransformers.outfit(row))
      setOutfits(outs)
    } catch {
      setOutfits([])
    } finally {
      setOutfitsLoading(false)
    }
  }

  useEffect(() => {
    fetchPage(page)
  }, [page])

  useEffect(() => {
    if (tab === 'outfits') loadOutfits()
  }, [tab])

  useEffect(() => {
    (async () => {
      try {
        const pairs = await Promise.all(
          items.map(async (g) => {
            if (g.status !== 'ready' || !g.storage_path) return [g.id, ''] as const
            const { data, error } = await supabase.storage.from('generations').createSignedUrl(g.storage_path, 3600)
            if (error) return [g.id, ''] as const
            return [g.id, data?.signedUrl || ''] as const
          })
        )
        const m: Record<string, string> = {}
        for (const [id, url] of pairs) if (url) m[id] = url
        setUrls(m)
      } catch {
        // ignore
      }
    })()
  }, [items])

  const filteredGenerations = useMemo(() => {
    if (statusFilter === 'all') return items
    return items.filter((item) => item.status === statusFilter)
  }, [items, statusFilter])

  const openViewerAt = (index: number, emitOverlay = false) => {
    const target = filteredGenerations[index]
    if (!target || target.status !== 'ready') return
    const url = urls[target.id]
    if (!url) return
    setViewer({ index, id: target.id, url, outfitId: target.outfit_id })
    if (emitOverlay) window.dispatchEvent(new Event('ui:overlay-open'))
  }

  const navigateViewer = (delta: number) => {
    if (!viewer) return
    const nextIndex = viewer.index + delta
    if (nextIndex < 0 || nextIndex >= filteredGenerations.length) return
    const target = filteredGenerations[nextIndex]
    if (!target || target.status !== 'ready') return
    const nextUrl = urls[target.id]
    if (!nextUrl) return
    setViewer({ index: nextIndex, id: target.id, url: nextUrl, outfitId: target.outfit_id })
  }

  useEffect(() => {
    if (!viewer) return
    const latestUrl = urls[viewer.id]
    if (latestUrl && latestUrl !== viewer.url) {
      setViewer((prev) => (prev ? { ...prev, url: latestUrl } : prev))
    }
  }, [urls, viewer])

  const currentGeneration = viewer ? filteredGenerations[viewer.index] : null
  const statusOptions: { key: 'all' | GenerationRow['status']; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'ready', label: 'Ready' },
    { key: 'generating', label: 'Generating' },
    { key: 'queued', label: 'Queued' },
    { key: 'failed', label: 'Failed' }
  ]

  useEffect(() => {
    if (!viewer) return
    const index = filteredGenerations.findIndex((item) => item.id === viewer.id)
    if (index === -1) {
      setViewer(null)
      window.dispatchEvent(new Event('ui:overlay-close'))
      return
    }
    if (index !== viewer.index) {
      const target = filteredGenerations[index]
      const url = urls[target.id]
      if (url) {
        setViewer({ index, id: target.id, url, outfitId: target.outfit_id })
      }
    }
  }, [filteredGenerations, viewer, urls])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant={tab === 'images' ? 'default' : 'outline'} onClick={() => setTab('images')}>Images</Button>
        <Button variant={tab === 'outfits' ? 'default' : 'outline'} onClick={() => setTab('outfits')}>Outfits</Button>
      </div>

      {tab === 'images' && (
        <div className="space-y-4">
          {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="w-full max-w-xs">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!loading && filteredGenerations.length === 0 && <div className="text-sm text-muted-foreground">No generations yet.</div>}
          <div className="space-y-4">
            {filteredGenerations.map((g, index) => (
              <Card key={g.id} className="overflow-hidden">
                <div className="relative">
                  <div className="absolute left-3 top-3">
                    <Badge variant={g.status === 'ready' ? 'default' : 'outline'} className="uppercase text-[0.65rem]">
                      {g.status}
                    </Badge>
                  </div>
                  <div
                    className="aspect-[3/4] w-full bg-muted flex items-center justify-center"
                    onClick={() => {
                      if (g.status !== 'ready' || !urls[g.id]) return
                      openViewerAt(index, true)
                    }}
                  >
                    {g.status === 'ready' && urls[g.id] ? (
                      <img
                        src={urls[g.id]}
                        alt="generation"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground">{g.status}</div>
                    )}
                  </div>
                </div>
                <CardContent className="p-4 space-y-3">
                  {g.created_at && (
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(g.created_at), { addSuffix: true })}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      disabled={!g.outfit_id || !!busyId}
                      onClick={async () => {
                        if (!g.outfit_id) return
                        setBusyId(g.id)
                        try {
                          const { data, error } = await supabase
                            .from('outfits')
                            .select(`
                              *,
                              occasion:occasions!occasion(id, name, slug, background_url, description),
                              top:products!outfits_top_id_fkey(*),
                              bottom:products!outfits_bottom_id_fkey(*),
                              shoes:products!outfits_shoes_id_fkey(*)
                            `)
                            .eq('id', g.outfit_id)
                            .single()
                          if (!error && data) {
                            const { dataTransformers } = await import('@/utils/dataTransformers')
                            const outfit = dataTransformers.outfit(data as any)
                            const evt = new CustomEvent('navigateToStudio', { detail: { outfit } })
                            window.dispatchEvent(evt)
                          }
                        } catch {
                          // ignore failures for now
                        } finally {
                          setBusyId(null)
                        }
                      }}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Open in Studio
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        className="flex-1"
                        disabled={g.status !== 'ready'}
                        onClick={() => {
                          if (g.status !== 'ready' || !urls[g.id]) return
                          const a = document.createElement('a')
                          a.href = urls[g.id]
                          a.download = `${g.id}.png`
                          a.click()
                        }}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        disabled={busyId === g.id}
                        onClick={async () => {
                          setBusyId(g.id)
                          try {
                            await (supabase as any).from('user_generations').delete().eq('id', g.id)
                            if (g.storage_path) {
                              await supabase.storage.from('generations').remove([g.storage_path])
                            }
                            await fetchPage(page)
                          } finally {
                            setBusyId(null)
                          }
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
            <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {tab === 'outfits' && (
        <div className="space-y-4">
          {outfitsLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!outfitsLoading && outfits.length === 0 && <div className="text-sm text-muted-foreground">No outfits yet.</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {outfits.map((o: any) => (
              <div key={o.id} onClick={() => {
                const evt = new CustomEvent('navigateToStudio', { detail: { outfit: o } })
                window.dispatchEvent(evt)
              }}>
                <OutfitCard outfit={o} maxCardWidth={200} />
              </div>
            ))}
          </div>
        </div>
      )}

      {viewer && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between p-4 pt-[env(safe-area-inset-top)] bg-black/40 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 border border-white/20"
              onClick={() => {
                setViewer(null)
                window.dispatchEvent(new Event('ui:overlay-close'))
              }}
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="text-white text-sm font-medium tracking-wide uppercase">Generations</div>
            <div className="w-10" />
          </div>

          <div
            className="relative flex-1 flex items-center justify-center px-6"
            onTouchStart={(event) => {
              const firstTouch = event.touches[0]
              setTouchStartX(firstTouch ? firstTouch.clientX : null)
            }}
            onTouchEnd={(event) => {
              if (touchStartX === null) return
              const touch = event.changedTouches[0]
              if (!touch) {
                setTouchStartX(null)
                return
              }
              const diff = touch.clientX - touchStartX
              if (Math.abs(diff) > 50) {
                navigateViewer(diff < 0 ? 1 : -1)
              }
              setTouchStartX(null)
            }}
          >
            <img
              src={viewer.url}
              alt="generation"
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />

            {viewer.index > 0 && (
              <button
                type="button"
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white"
                onClick={() => navigateViewer(-1)}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}

            {viewer.index < filteredGenerations.length - 1 && (
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white"
                onClick={() => navigateViewer(1)}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="bg-black/60 backdrop-blur-md border-t border-white/10 p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
            <div className="mx-auto w-full max-w-md space-y-4 text-white">
              <div className="flex items-center justify-between text-[0.7rem] uppercase tracking-wide text-white/60">
                <span>{currentGeneration?.created_at ? formatDistanceToNow(new Date(currentGeneration.created_at), { addSuffix: true }) : 'Just now'}</span>
                <span>{`Look ${viewer.index + 1} of ${filteredGenerations.length}`}</span>
              </div>
              <div className="text-sm text-white/80">
                {currentGeneration?.status === 'ready' ? 'Ready to remix in Studio' : `Status: ${currentGeneration?.status ?? 'unknown'}`}
              </div>
              <div className="space-y-2">
                <Button
                  className="w-full h-12 text-sm"
                  disabled={!viewer.outfitId || busy}
                  onClick={async () => {
                    if (!viewer.outfitId) return
                    setBusy(true)
                    try {
                      const { data, error } = await supabase
                        .from('outfits')
                        .select(`
                          *,
                          occasion:occasions!occasion(id, name, slug, background_url, description),
                          top:products!outfits_top_id_fkey(*),
                          bottom:products!outfits_bottom_id_fkey(*),
                          shoes:products!outfits_shoes_id_fkey(*)
                        `)
                        .eq('id', viewer.outfitId)
                        .single()
                      if (!error && data) {
                        const { dataTransformers } = await import('@/utils/dataTransformers')
                        const outfit = dataTransformers.outfit(data as any)
                        const evt = new CustomEvent('navigateToStudio', { detail: { outfit } })
                        window.dispatchEvent(evt)
                        setViewer(null)
                        window.dispatchEvent(new Event('ui:overlay-close'))
                      }
                    } catch {
                      // ignore errors for now
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Open in Studio
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    className="h-11 text-sm"
                    disabled={busy || currentGeneration?.status !== 'ready'}
                    onClick={() => {
                      if (currentGeneration?.status !== 'ready') return
                      const a = document.createElement('a')
                      a.href = viewer.url
                      a.download = `${viewer.id}.png`
                      a.click()
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                  <Button
                    variant="destructive"
                    className="h-11 text-sm"
                    disabled={busy}
                    onClick={async () => {
                      if (!currentGeneration) return
                      setBusy(true)
                      try {
                        await (supabase as any).from('user_generations').delete().eq('id', currentGeneration.id)
                        if (currentGeneration.storage_path) {
                          await supabase.storage.from('generations').remove([currentGeneration.storage_path])
                        }
                        setViewer(null)
                        window.dispatchEvent(new Event('ui:overlay-close'))
                        await fetchPage(page)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
