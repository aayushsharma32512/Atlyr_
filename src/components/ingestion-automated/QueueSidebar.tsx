import { useState } from 'react'
import {
  ChevronsLeft, ChevronsRight, Search, RefreshCcw, Trash2, ArrowUpRight,
  ChevronLeft, ChevronRight, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { v2Api } from '@/utils/ingestionV2Api'
import type { useQueueState, FilterKey, RowsPerPage, SortKey } from './useQueueState'
import type { RowState, Stage } from './stateMapping'
import { useNotWiredDialog } from './NotWiredDialog'

const STATE_META: { key: RowState; icon: string; label: string }[] = [
  { key: 'attention',  icon: '⚑', label: 'Needs review' },
  { key: 'ready',      icon: '✓', label: 'Ready' },
  { key: 'processing', icon: '◌', label: 'Processing' },
  { key: 'error',      icon: '✕', label: 'Error' },
]

const FILTER_GROUPS: { key: FilterKey; label: string }[] = [
  { key: 'gender', label: 'Gender' },
  { key: 'category', label: 'Category' },
  { key: 'sub', label: 'Sub-category' },
  { key: 'complexity', label: 'Complexity' },
]

type QueueState = ReturnType<typeof useQueueState>

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-2.5 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/70">
      {children}
    </p>
  )
}

type Props = {
  queue: QueueState
  onAddItem: () => void
}

export function QueueSidebar({ queue, onAddItem }: Props) {
  const { model, actions, visible } = queue
  const [restarting, setRestarting] = useState(false)
  const [pushing, setPushing] = useState(false)
  const { toast } = useToast()
  const { notify, dialog } = useNotWiredDialog()

  const selectedCount = model.selected.size
  const allVisSelected = visible.length > 0 && visible.every(v => model.selected.has(v.job.job_id))

  const handleBulkRestart = async () => {
    const targets = visible.filter(v => model.selected.has(v.job.job_id))
    if (targets.length === 0) return
    setRestarting(true)
    let ok = 0
    for (const { job, stage } of targets) {
      const from = job.last_error_step ?? (stage === 1 ? 'scraping' : 'generating_vton')
      try { await v2Api.restart(job.job_id, from); ok++ } catch { /* reported in aggregate below */ }
    }
    toast({ title: `Restarted ${ok}/${targets.length}`, description: ok < targets.length ? 'Some jobs could not be restarted from their current state.' : undefined })
    setRestarting(false)
    queue.refetch()
  }

  const handleBulkPush = async () => {
    const targets = visible.filter(v => model.selected.has(v.job.job_id) && ['awaiting_hitl_identification', 'awaiting_hitl_segmentation'].includes(v.job.current_state))
    const skipped = selectedCount - targets.length
    if (targets.length === 0) {
      notify('Bulk push', 'None of the selected jobs are awaiting HITL review right now.')
      return
    }
    setPushing(true)
    let ok = 0
    for (const { job } of targets) {
      try { await v2Api.proceed(job.job_id, {}); ok++ } catch { /* aggregate below */ }
    }
    toast({ title: `Pushed ${ok}/${targets.length}`, description: skipped > 0 ? `${skipped} skipped — not awaiting review` : undefined })
    setPushing(false)
    queue.refetch()
  }

  if (model.collapsed) {
    return (
      <div className="flex flex-col h-full w-14 border-r border-border bg-background items-center py-3 gap-3">
        <button onClick={actions.toggleCollapse} className="text-muted-foreground hover:text-foreground" aria-label="Expand sidebar">
          <ChevronsRight className="h-4 w-4" />
        </button>
        <button onClick={actions.toggleCollapse} className="text-muted-foreground hover:text-foreground" aria-label="Search">
          <Search className="h-4 w-4" />
        </button>
        <div className="h-px w-6 bg-border" />
        {([1, 2] as Stage[]).map(s => (
          <button
            key={s}
            onClick={() => actions.toggleStage(s)}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded px-1.5 py-1 text-[10px] font-semibold',
              model.stageFilter.has(s) ? 'bg-muted text-foreground' : 'text-muted-foreground'
            )}
          >
            S{s}
            <span className="text-[9px] font-normal">{s === 1 ? model.counts.stage1 : model.counts.stage2}</span>
          </button>
        ))}
        {model.counts.attention > 0 && (
          <span className="mt-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] px-1.5 py-0.5 font-semibold">
            ⚑ {model.counts.attention}
          </span>
        )}
        <Button size="icon" className="h-8 w-8 mt-auto" onClick={onAddItem} aria-label="Add items">+</Button>
        {dialog}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-[212px] shrink-0 border-r border-border bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="min-w-0">
          <p className="text-xs font-semibold leading-tight">Atlyr</p>
          <p className="text-[10px] text-muted-foreground leading-tight">Ingestion — automated</p>
        </div>
        <button onClick={actions.toggleCollapse} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Collapse sidebar">
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-2.5 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
          <Input
            className="h-[26px] pl-6 text-[11px]"
            placeholder="Search…"
            value={model.search}
            onChange={e => actions.setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Selection + bulk actions */}
      <div className="px-2.5 py-2 border-b border-border flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <Checkbox checked={allVisSelected} onCheckedChange={actions.selectAllVis} className="h-3.5 w-3.5" />
          <span className="text-[10.5px] text-muted-foreground">{selectedCount ? `${selectedCount} sel.` : `${visible.length} shown`}</span>
        </div>
        <div className="flex gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!selectedCount || restarting} onClick={handleBulkRestart} title="Restart selected">
            <RefreshCcw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!selectedCount} onClick={() => notify('Bulk delete')} title="Delete selected">
            <Trash2 className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!selectedCount || pushing} onClick={handleBulkPush} title="Push selected">
            <ArrowUpRight className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Stage toggle */}
      <SectionLabel>Stage</SectionLabel>
      <div className="px-2.5 pb-1.5 flex gap-1.5">
        {([1, 2] as Stage[]).map(s => (
          <button
            key={s}
            onClick={() => actions.toggleStage(s)}
            className={cn(
              'flex-1 text-[10.5px] font-medium rounded border px-2 py-1 transition-colors',
              model.stageFilter.has(s)
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-muted-foreground border-border hover:text-foreground'
            )}
          >
            S{s} · {s === 1 ? model.counts.stage1 : model.counts.stage2}
          </button>
        ))}
      </div>

      {/* State filter chips */}
      <SectionLabel>State</SectionLabel>
      <div className="px-2.5 pb-2 flex flex-wrap gap-1">
        {STATE_META.map(({ key, icon, label }) => (
          <button
            key={key}
            title={label}
            onClick={() => actions.toggleState(key)}
            className={cn(
              'text-[10px] rounded-full border px-1.5 py-0.5 font-medium transition-colors',
              model.stateFilters.has(key)
                ? 'bg-muted border-border text-foreground'
                : 'bg-background border-border text-muted-foreground/50'
            )}
          >
            {icon} {model.counts[key]}
          </button>
        ))}
      </div>

      <div className="h-px bg-border mx-2.5 mb-2" />

      {/* Rows + sort */}
      <div className="px-2.5 pb-1 flex gap-1.5">
        <span className="flex-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/70">Rows</span>
        <span className="flex-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/70">Sort</span>
      </div>
      <div className="px-2.5 pb-2 grid grid-cols-2 gap-1.5">
        <Select value={String(model.rowsPerPage)} onValueChange={v => actions.pickRows(Number(v) as RowsPerPage)}>
          <SelectTrigger className="h-[26px] text-[10.5px] px-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            {model.rowsOptions.map(n => (
              <SelectItem key={n} value={String(n)} className="text-xs">{n >= 100 ? 'All' : `${n} rows`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={model.sort} onValueChange={v => actions.pickSort(v as SortKey)}>
          <SelectTrigger className="h-[26px] text-[10.5px] px-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="date_desc" className="text-xs">Date ↓</SelectItem>
            <SelectItem value="date_asc" className="text-xs">Date ↑</SelectItem>
            <SelectItem value="url_asc" className="text-xs">Link A–Z</SelectItem>
            <SelectItem value="url_desc" className="text-xs">Link Z–A</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filters accordion — the only scrolling region */}
      <SectionLabel>Filters</SectionLabel>
      <div className="flex-1 overflow-y-auto px-2.5 min-h-0">
        <Accordion type="multiple" className="w-full">
          {FILTER_GROUPS.map(({ key, label }) => {
            const options = model.filterOptions[key]
            const active = model.filters[key]
            if (options.length === 0) return null
            return (
              <AccordionItem key={key} value={key} className="border-border">
                <AccordionTrigger className="py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline">
                  {label} {active.size > 0 && <span className="ml-1 text-foreground">({active.size})</span>}
                </AccordionTrigger>
                <AccordionContent className="pb-2">
                  <div className="flex flex-col gap-1">
                    {options.map(opt => (
                      <label key={opt} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                        <Checkbox
                          checked={active.has(opt)}
                          onCheckedChange={() => actions.toggleFilterOption(key, opt)}
                          className="h-3 w-3"
                        />
                        <span className="truncate">{opt}</span>
                      </label>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>

        {/* Active filter chips */}
        {FILTER_GROUPS.some(({ key }) => model.filters[key].size > 0) && (
          <div className="flex flex-wrap gap-1 py-2">
            {FILTER_GROUPS.flatMap(({ key }) => Array.from(model.filters[key]).map(v => (
              <span key={`${key}-${v}`} className="flex items-center gap-1 text-[10px] bg-muted rounded-full pl-2 pr-1 py-0.5">
                {v}
                <button onClick={() => actions.clearChip(key, v)}><X className="h-2.5 w-2.5" /></button>
              </span>
            )))}
          </div>
        )}
      </div>

      {/* Bottom-pinned block */}
      <div className="border-t border-border px-2.5 py-2 flex flex-col gap-2">
        <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
          <button onClick={actions.prevPage} disabled={model.page === 0} className="disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>Page {model.page + 1} / {model.pageCount}</span>
          <button onClick={actions.nextPage} disabled={model.page >= model.pageCount - 1} className="disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <button onClick={actions.clearAllFilters} className="text-[10.5px] text-muted-foreground hover:text-foreground underline underline-offset-2">
          Reset filters
        </button>
        <Button size="sm" className="h-7 text-xs w-full" onClick={onAddItem}>+ Add items</Button>
      </div>
      {dialog}
    </div>
  )
}
