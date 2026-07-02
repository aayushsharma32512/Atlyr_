import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { RefreshCcw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useIngestionV2Jobs } from '@/hooks/useIngestionV2Jobs'
import { STATE_LABELS, STATE_VARIANTS, ACTIVE_STATES, AWAITING_STATES } from './constants'

type FilterTab = 'all' | 'active' | 'awaiting' | 'done' | 'failed'

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all',     label: 'All' },
  { value: 'active',  label: 'Active' },
  { value: 'awaiting', label: 'Review' },
  { value: 'done',    label: 'Done' },
  { value: 'failed',  label: 'Failed' },
]

function stateMatchesFilter(state: string, filter: FilterTab): boolean {
  if (filter === 'all') return true
  if (filter === 'active')  return ACTIVE_STATES.has(state)
  if (filter === 'awaiting') return AWAITING_STATES.has(state)
  if (filter === 'done')    return state === 'completed'
  if (filter === 'failed')  return state === 'failed' || state === 'discarded' || state === 'cancelled'
  return true
}

type Props = {
  selectedJobId: string | null
  onSelectJob: (jobId: string) => void
  onSubmitClick: () => void
}

export function JobListSidebarV2({ selectedJobId, onSelectJob, onSubmitClick }: Props) {
  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const { jobs, loading, refetch } = useIngestionV2Jobs()

  const visible = jobs.filter(j =>
    stateMatchesFilter(j.current_state, filter) &&
    (search === '' || j.product_url.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold">Jobs</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch}>
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={onSubmitClick}>
            + Submit
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-border px-2 pt-1 gap-0.5">
        {FILTER_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setFilter(t.value)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-t border-b-2 transition-colors',
              filter === t.value
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="h-7 pl-7 text-xs"
            placeholder="Search URL…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Job list */}
      <ScrollArea className="flex-1">
        {loading && jobs.length === 0 ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No jobs</p>
        ) : (
          visible.map(job => (
            <button
              key={job.job_id}
              onClick={() => onSelectJob(job.job_id)}
              className={cn(
                'w-full text-left px-3 py-2.5 border-b border-border transition-colors hover:bg-muted/50',
                selectedJobId === job.job_id && 'bg-muted border-l-2 border-l-primary'
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <Badge variant={STATE_VARIANTS[job.current_state] ?? 'outline'} className="text-[10px] h-4">
                  {STATE_LABELS[job.current_state] ?? job.current_state}
                </Badge>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate max-w-[240px]">
                {job.product_url}
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {job.product_gender_type} · {job.product_type}
                {job.last_error && <span className="text-destructive ml-1">· {job.error_count} err</span>}
              </p>
            </button>
          ))
        )}
      </ScrollArea>
    </div>
  )
}
