import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { v2Api, type PipelineJob } from '@/utils/ingestionV2Api'
import { supabase } from '@/integrations/supabase/client'
import { summarizeBatches, estimateCost, actualCost, usd, type ArtifactRow, type BatchProgress } from './bulkIngest'

/** Blue bar with white diagonal stripes; animates while work is still in flight. */
function StripedBar({ percent, active }: { percent: number; active: boolean }) {
  return (
    <div className="h-4 w-full rounded-full border border-border bg-muted overflow-hidden">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width: `${Math.max(percent, percent > 0 ? 3 : 0)}%`,
          backgroundColor: '#2f7fe0',
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(255,255,255,.85) 0 8px, rgba(255,255,255,0) 8px 16px)',
          backgroundSize: '22px 22px',
          animation: active ? 'atlyr-stripes 1s linear infinite' : undefined,
        }}
      />
      <style>{'@keyframes atlyr-stripes{from{background-position:0 0}to{background-position:22px 0}}'}</style>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className={`text-sm font-semibold ${tone ?? ''}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

function BatchDetail({ batch, onBack }: { batch: BatchProgress; onBack: () => void }) {
  const [artifacts, setArtifacts] = useState<ArtifactRow[] | null>(null)

  // Cost is billed from recorded usage once a job finishes its model calls, so we only pull
  // artifacts when the batch has settled — mid-run the estimate is shown instead.
  const settled = batch.running === 0 && batch.total > 0

  useEffect(() => {
    let cancelled = false
    if (!settled) { setArtifacts(null); return }
    ;(async () => {
      const ids = batch.jobs.map(j => j.job_id)
      // pipeline_step_artifacts is not in the generated types — cast, as elsewhere in the app.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('pipeline_step_artifacts')
        .select('job_id, artifact_type, data')
        .in('job_id', ids)
      if (!cancelled) setArtifacts((data ?? []) as ArtifactRow[])
    })()
    return () => { cancelled = true }
    // batch.jobs is deliberately omitted: it is a fresh array on every 8s poll, which would
    // refetch artifacts continuously. Batch identity + size is enough to know when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, batch.id, batch.total])

  const cost = useMemo(() => {
    const exact = artifacts ? actualCost(artifacts) : null
    return exact ?? estimateCost(batch.jobs)
  }, [artifacts, batch.jobs])
  const done = batch.jobs.filter(j => j.current_state === 'completed')
  const review = batch.jobs.filter(j => j.current_state.startsWith('awaiting_hitl'))
  const failed = batch.jobs.filter(j => ['failed', 'discarded', 'cancelled'].includes(j.current_state))
  const left = batch.jobs.filter(j =>
    !done.includes(j) && !review.includes(j) && !failed.includes(j))

  // Product URLs bury the readable slug at different depths — Myntra ends in
  // /<slug>/<id>/buy, Shopify uses /products/<slug>, /collections/<x>/products/<slug>.
  // Taking the last segment would render every Myntra row as "buy", so drop the routing
  // words and numeric ids and keep the longest remaining segment (the descriptive slug).
  const ROUTE_WORDS = new Set(['buy', 'p', 'dp', 'products', 'product', 'collections', 'collection', 'item'])
  const name = (j: PipelineJob) => {
    try {
      const segments = new URL(j.product_url).pathname.split('/').filter(Boolean)
        .map(decodeURIComponent)
        .filter(s => !ROUTE_WORDS.has(s.toLowerCase()) && !/^\d+$/.test(s))
      const slug = segments.sort((a, b) => b.length - a.length)[0]
      if (!slug) return j.product_url
      return slug.replace(/[-_+]+/g, ' ').trim()
    } catch { return j.product_url }
  }

  const List = ({ title, jobs, tone }: { title: string; jobs: PipelineJob[]; tone: string }) =>
    jobs.length ? (
      <div className="mt-3">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{title} ({jobs.length})</p>
        <ul className="mt-1 space-y-0.5">
          {jobs.map(j => (
            <li key={j.job_id} className="text-[11px] text-muted-foreground truncate" title={j.product_url}>
              · {name(j)}
              {j.current_state === 'failed' && j.last_error_step ? (
                <span className="text-destructive"> — failed at {j.last_error_step}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium truncate">{batch.label}</span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <StripedBar percent={batch.percent} active={batch.running > 0} />
        <span className="text-sm font-semibold tabular-nums">{batch.percent}%</span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <Stat label="Done" value={done.length} tone="text-emerald-600" />
        <Stat label="Review" value={review.length} tone="text-amber-600" />
        <Stat label="Left" value={left.length} />
        <Stat label="Failed" value={failed.length} tone="text-destructive" />
      </div>

      <div className="mt-3 rounded-md border border-border p-2.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cost {cost.isEstimate ? '(estimate)' : '(actual)'}
          </p>
          <p className="text-sm font-semibold tabular-nums">{usd(cost.total)}</p>
        </div>
        <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
          <div className="flex justify-between"><span>Gemini · garment summary</span><span className="tabular-nums">{usd(cost.geminiText)}</span></div>
          <div className="flex justify-between"><span>Gemini · VTON ({cost.vtonRuns} images)</span><span className="tabular-nums">{usd(cost.geminiVton)}</span></div>
          <div className="flex justify-between"><span>Modal · segment + place ({cost.modalRuns} runs)</span><span className="tabular-nums">{usd(cost.modal)}</span></div>
          {cost.isEstimate ? (
            <p className="pt-1 text-[10px] italic">
              Estimate — from per-operation list prices, including retries ({cost.attempts} attempts
              across {batch.total} items). Exact figures appear once the batch finishes.
              {settled && ' These items ran before usage tracking, so no token data was recorded.'}
            </p>
          ) : (
            <p className="pt-1 text-[10px] italic">
              Billed from recorded usage — actual tokens per Gemini call and measured Modal GPU time,
              retries included.
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <List title="Done" jobs={done} tone="text-emerald-600" />
        <List title="Awaiting review" jobs={review} tone="text-amber-600" />
        <List title="Still running" jobs={left} tone="text-muted-foreground" />
        <List title="Failed" jobs={failed} tone="text-destructive" />
      </div>

      <div className="pt-3">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
      </div>
    </div>
  )
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

export function IngestionStatusDialog({ open, onOpenChange }: Props) {
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try { setJobs((await v2Api.listJobs()).jobs) } catch { /* surfaced as empty state */ }
    finally { setLoading(false) }
  }

  // Refresh on open, then poll while the dialog stays open so progress moves live.
  useEffect(() => {
    if (!open) return
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [open])

  const batches = useMemo(() => summarizeBatches(jobs), [jobs])
  const active = selected ? batches.find(b => b.id === selected) ?? null : null

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setSelected(null) }}>
      <DialogContent className="max-w-[460px] max-h-[84vh] flex flex-col">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-sm">{active ? 'Ingestion status' : 'Status'}</DialogTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6 mr-6" onClick={load} aria-label="Refresh">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </DialogHeader>

        {active ? (
          <BatchDetail batch={active} onBack={() => setSelected(null)} />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
            {batches.length === 0 && (
              <p className="py-10 text-center text-xs text-muted-foreground">
                {loading ? 'Loading…' : 'No bulk ingestions yet — upload a sheet from “Add items → Excel upload”.'}
              </p>
            )}
            {batches.map(b => (
              <button
                key={b.id}
                onClick={() => setSelected(b.id)}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium truncate">{b.label}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{b.percent}%</span>
                </div>
                <div className="mt-1.5"><StripedBar percent={b.percent} active={b.running > 0} /></div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {b.completed} done · {b.hitl} review · {b.running} running · {b.failed} failed — of {b.total}
                </p>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
