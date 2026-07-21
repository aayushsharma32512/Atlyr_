import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { v2Api, type PipelineJob } from '@/utils/ingestionV2Api'
import {
  RESTARTABLE_STATES, RESTARTABLE_STATE_LABELS, STEP_ORDER,
  AWAITING_STATES, TERMINAL_STATES,
} from './constants'

const BASE_URL = (import.meta.env as Record<string, string>).VITE_INGESTION_V2_API_URL ?? 'http://localhost:3001'

// Steps that get deleted vs kept when restarting from a given state
function getRestartImpact(fromState: string) {
  const fromIdx = STEP_ORDER.indexOf(fromState as typeof STEP_ORDER[number])
  const kept = STEP_ORDER.slice(0, fromIdx)
  const deleted = STEP_ORDER.slice(fromIdx + 1)
  return { kept, restarting: fromState, deleted }
}

type Props = { job: PipelineJob; onRefetch: () => void }

export function JobStateControl({ job, onRefetch }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  // Restart state
  const defaultRestart = useMemo(() => {
    if (job.last_error_step && RESTARTABLE_STATES.includes(job.last_error_step as typeof RESTARTABLE_STATES[number])) {
      return job.last_error_step
    }
    return 'scraping'
  }, [job.last_error_step])
  const [restartFrom, setRestartFrom] = useState(defaultRestart)

  // HITL proceed state
  const [vtonOverride, setVtonOverride] = useState('')
  const [segOverride, setSegOverride] = useState('')

  const isAwaiting = AWAITING_STATES.has(job.current_state)
  const isPlacement = job.current_state === 'placement'
  const canRestart = TERMINAL_STATES.has(job.current_state)
    || AWAITING_STATES.has(job.current_state)
    || RESTARTABLE_STATES.includes(job.current_state as typeof RESTARTABLE_STATES[number])

  const impact = getRestartImpact(restartFrom)

  const handleRestart = async () => {
    setLoading(true)
    try {
      await v2Api.restart(job.job_id, restartFrom)
      toast({ title: 'Job restarted', description: `From ${restartFrom}` })
      onRefetch()
    } catch (e) {
      toast({ title: 'Restart failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleProceed = async () => {
    setLoading(true)
    try {
      const body: Parameters<typeof v2Api.proceed>[1] = {}
      if (vtonOverride.trim()) body.vton_image_override = vtonOverride.trim()
      if (segOverride.trim()) body.segmented_image_override = segOverride.trim()
      const res = await v2Api.proceed(job.job_id, body)
      toast({ title: 'Job resumed', description: `→ ${res.current_state}` })
      setVtonOverride('')
      setSegOverride('')
      onRefetch()
    } catch (e) {
      toast({ title: 'Proceed failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Error banner */}
      {job.last_error && (
        <Alert variant="destructive">
          <AlertTitle className="text-sm">Failed at {job.last_error_step}</AlertTitle>
          <AlertDescription className="text-xs font-mono mt-1">{job.last_error}</AlertDescription>
        </Alert>
      )}

      {/* ── HITL Proceed ── */}
      {isAwaiting && (
        <Card className={job.current_state.includes('identification') ? 'border-amber-500/40' : 'border-blue-500/40'}>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">
              {job.current_state === 'awaiting_hitl_identification'
                ? '▶ HITL — Identification Review'
                : job.current_state === 'placement'
                ? '▶ Placement — Ready to Run Garment Placement'
                : '▶ HITL — Segmentation Review'}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {job.current_state === 'placement'
                ? 'Segmentation is verified. Click below to trigger cloud GPU placement and composite the garment onto the mannequin avatar.'
                : 'Review the step outputs in the Step Details tab, then proceed or override.'}
            </p>

            {job.current_state === 'awaiting_hitl_identification' && (
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">VTon Image Override (optional)</Label>
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder={`${job.job_id}/raw/2.jpg — leave blank to accept SigLIP selection`}
                  value={vtonOverride}
                  onChange={e => setVtonOverride(e.target.value)}
                />
              </div>
            )}

            {job.current_state === 'awaiting_hitl_segmentation' && (
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Segmented Image Override (optional)</Label>
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="Paste storage path to override segmented image"
                  value={segOverride}
                  onChange={e => setSegOverride(e.target.value)}
                />
              </div>
            )}

            <div className="bg-muted rounded px-3 py-2 font-mono text-[10px] text-muted-foreground leading-relaxed">
              POST {BASE_URL}/jobs/{job.job_id}/proceed
            </div>

            <Button size="sm" onClick={handleProceed} disabled={loading}>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
              {job.current_state === 'placement' ? 'Run Garment Placement' : 'Proceed to Next Step'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Restart from Step ── */}
      <Card className={!canRestart ? 'opacity-50' : ''}>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">↺ Restart from Step</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex flex-col gap-3">
          {!canRestart ? (
            <p className="text-xs text-muted-foreground">
              Job is actively processing. Wait for it to reach a failed or HITL state.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Artifacts from the selected step onwards are deleted and regenerated. Steps before it are kept.
              </p>

              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Restart from</Label>
                <Select value={restartFrom} onValueChange={setRestartFrom}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESTARTABLE_STATES.map(s => (
                      <SelectItem key={s} value={s} className="text-xs">
                        {RESTARTABLE_STATE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Impact chips */}
              <div className="flex flex-wrap gap-1.5">
                {impact.kept.map(s => (
                  <Badge key={s} variant="outline" className="text-[10px] text-muted-foreground">{s} ✓ kept</Badge>
                ))}
                <Badge key={impact.restarting} className="text-[10px] bg-blue-600 hover:bg-blue-600">↺ {impact.restarting}</Badge>
                {impact.deleted.map(s => (
                  <Badge key={s} variant="destructive" className="text-[10px] opacity-70">{s} deleted</Badge>
                ))}
              </div>

              {/* Curl preview */}
              <div className="bg-muted rounded px-3 py-2 font-mono text-[10px] text-muted-foreground leading-relaxed">
                POST {BASE_URL}/jobs/{job.job_id}/restart<br />
                {'{'} "from_state": "{restartFrom}" {'}'}
              </div>

              <Button size="sm" variant="destructive" onClick={handleRestart} disabled={loading}>
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
                Restart from {restartFrom}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Placement (read-only note, full verdict form is a separate step) ── */}
      {isPlacement && (
        <Card className="border-blue-500/40">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">◎ Placement & Verdict</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xs text-muted-foreground mb-3">
              Job is awaiting placement. Use the API or the placement form to submit verdict.
            </p>
            <div className="bg-muted rounded px-3 py-2 font-mono text-[10px] text-muted-foreground leading-relaxed">
              POST {BASE_URL}/jobs/{job.job_id}/placement<br />
              {'{'} "verdict": "approved", "admin_id": "...",<br />
              &nbsp;&nbsp;"placement_x": 0, "placement_y": 0,<br />
              &nbsp;&nbsp;"body_parts_visible": ["torso"] {'}'}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
