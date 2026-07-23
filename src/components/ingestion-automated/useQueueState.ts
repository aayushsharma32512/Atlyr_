import { useMemo, useState } from 'react'
import type { PipelineJob } from '@/utils/ingestionV2Api'
import { useIngestionV2Jobs } from '@/hooks/useIngestionV2Jobs'
import { stageOf, rowStateOf, type Stage, type RowState } from './stateMapping'

export type SortKey = 'date_desc' | 'date_asc' | 'url_asc' | 'url_desc'
export type RowsPerPage = 4 | 10 | 25 | 100

export type FilterKey = 'gender' | 'category' | 'sub' | 'complexity'

const ROWS_OPTIONS: RowsPerPage[] = [4, 10, 25, 100]

function sortJobs(jobs: PipelineJob[], sort: SortKey): PipelineJob[] {
  const sorted = [...jobs]
  switch (sort) {
    case 'date_asc':  return sorted.sort((a, b) => a.created_at.localeCompare(b.created_at))
    case 'url_asc':   return sorted.sort((a, b) => a.product_url.localeCompare(b.product_url))
    case 'url_desc':  return sorted.sort((a, b) => b.product_url.localeCompare(a.product_url))
    case 'date_desc':
    default:          return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
}

export function useQueueState() {
  const { jobs, loading, error, refetch } = useIngestionV2Jobs()

  const [collapsed, setCollapsed] = useState(false)
  const [stageFilter, setStageFilter] = useState<Set<Stage>>(new Set([1, 2]))
  const [stateFilters, setStateFilters] = useState<Set<RowState>>(new Set(['ready', 'processing', 'attention', 'error']))
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<FilterKey, Set<string>>>({
    gender: new Set(), category: new Set(), sub: new Set(), complexity: new Set(),
  })
  const [sort, setSort] = useState<SortKey>('date_desc')
  const [rowsPerPage, setRowsPerPage] = useState<RowsPerPage>(10)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Distinct values per filterable field, for the Filters accordion.
  const filterOptions = useMemo(() => ({
    gender: Array.from(new Set(jobs.map(j => j.product_gender_type))).sort(),
    category: Array.from(new Set(jobs.map(j => j.product_type))).sort(),
    sub: Array.from(new Set(jobs.map(j => j.product_sub_type).filter(Boolean))).sort(),
    complexity: Array.from(new Set(jobs.map(j => j.product_complexity))).sort(),
  }), [jobs])

  const withMeta = useMemo(() => jobs.map(job => ({
    job,
    stage: stageOf(job),
    rowState: rowStateOf(job),
  })), [jobs])

  // Filtered + sorted, but NOT paged — mirrors the prototype's "select all visible"
  // acting across every matching item, not just the current page.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = withMeta.filter(({ job, stage, rowState }) => {
      if (!stageFilter.has(stage)) return false
      if (!stateFilters.has(rowState)) return false
      if (q && !job.product_url.toLowerCase().includes(q)
        && !job.product_type.toLowerCase().includes(q)
        && !job.product_sub_type.toLowerCase().includes(q)) return false
      if (filters.gender.size && !filters.gender.has(job.product_gender_type)) return false
      if (filters.category.size && !filters.category.has(job.product_type)) return false
      if (filters.sub.size && !filters.sub.has(job.product_sub_type)) return false
      if (filters.complexity.size && !filters.complexity.has(job.product_complexity)) return false
      return true
    })
    return sortJobs(filtered.map(f => f.job), sort).map(job => withMeta.find(m => m.job.job_id === job.job_id)!)
  }, [withMeta, stageFilter, stateFilters, search, filters, sort])

  const pageCount = Math.max(1, Math.ceil(visible.length / rowsPerPage))
  const clampedPage = Math.min(page, pageCount - 1)
  const paged = useMemo(
    () => rowsPerPage >= 100 ? visible : visible.slice(clampedPage * rowsPerPage, (clampedPage + 1) * rowsPerPage),
    [visible, clampedPage, rowsPerPage]
  )

  const counts = useMemo(() => {
    const c: Record<RowState, number> = { ready: 0, processing: 0, attention: 0, error: 0 }
    for (const { rowState } of withMeta) c[rowState]++
    const stage1 = withMeta.filter(m => m.stage === 1).length
    const stage2 = withMeta.filter(m => m.stage === 2).length
    return { ...c, stage1, stage2 }
  }, [withMeta])

  const actions = {
    toggleCollapse: () => setCollapsed(c => !c),

    toggleStage: (s: Stage) => setStageFilter(prev => {
      const next = new Set(prev)
      if (next.has(s)) { if (next.size > 1) next.delete(s) } else next.add(s)
      setSelected(new Set())
      return next
    }),

    toggleState: (s: RowState) => setStateFilters(prev => {
      const next = new Set(prev)
      if (next.has(s)) { if (next.size > 1) next.delete(s) } else next.add(s)
      return next
    }),

    setSearch: (v: string) => { setSearch(v); setPage(0) },

    toggleFilterOption: (key: FilterKey, value: string) => setFilters(prev => {
      const next = new Set(prev[key])
      if (next.has(value)) next.delete(value); else next.add(value)
      setPage(0)
      return { ...prev, [key]: next }
    }),

    clearChip: (key: FilterKey, value: string) => setFilters(prev => {
      const next = new Set(prev[key])
      next.delete(value)
      return { ...prev, [key]: next }
    }),

    clearAllFilters: () => {
      setFilters({ gender: new Set(), category: new Set(), sub: new Set(), complexity: new Set() })
      setSearch('')
      setStateFilters(new Set(['ready', 'processing', 'attention', 'error']))
    },

    pickRows: (n: RowsPerPage) => { setRowsPerPage(n); setPage(0) },
    pickSort: (s: SortKey) => setSort(s),
    prevPage: () => setPage(p => Math.max(0, p - 1)),
    nextPage: () => setPage(p => Math.min(pageCount - 1, p + 1)),

    toggleSelect: (jobId: string) => setSelected(prev => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId)
      return next
    }),

    selectAllVis: () => setSelected(prev => {
      const allIds = visible.map(v => v.job.job_id)
      const allSelected = allIds.length > 0 && allIds.every(id => prev.has(id))
      return allSelected ? new Set() : new Set(allIds)
    }),

    clearSelection: () => setSelected(new Set()),
  }

  return {
    jobs, loading, error, refetch,
    model: {
      collapsed, stageFilter, stateFilters, search, filters, filterOptions,
      sort, rowsPerPage, rowsOptions: ROWS_OPTIONS, page: clampedPage, pageCount,
      selected, counts, visibleCount: visible.length,
    },
    actions,
    visible,
    paged,
  }
}
