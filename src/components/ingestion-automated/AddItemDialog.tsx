import { useRef, useState } from 'react'
import { Download, Loader2, UploadCloud } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { v2Api, DuplicateJobError, type SubmitJobBody } from '@/utils/ingestionV2Api'
import { useNotWiredDialog } from './NotWiredDialog'
import { batchIdFor, downloadTemplate, parseWorkbook, type BulkRow } from './bulkIngest'
import { useBulkIngest } from './useBulkIngest'

const EMPTY: SubmitJobBody = {
  product_url: '',
  product_gender_type: 'female',
  product_type: 'topwear',
  product_sub_type: '',
  product_complexity: 'simple',
  hitl_post_identification: false,
  // On by default — operators verify/erase the segmented garment before placement.
  hitl_post_segmentation: true,
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (jobId: string) => void
  onDuplicate: (existingJobId: string) => void
  /** Called as a bulk run progresses so the queue behind the dialog stays current. */
  onProgress?: () => void
}

export function AddItemDialog({ open, onOpenChange, onSuccess, onDuplicate, onProgress }: Props) {
  const [form, setForm] = useState<SubmitJobBody>(EMPTY)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const { notify, dialog } = useNotWiredDialog()

  const set = <K extends keyof SubmitJobBody>(k: K, v: SubmitJobBody[K]) => setForm(f => ({ ...f, [k]: v }))

  // ── Excel bulk upload ───────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<BulkRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const bulk = useBulkIngest()

  const handleFile = async (file: File) => {
    bulk.reset()
    try {
      const { rows: parsed, errors } = parseWorkbook(await file.arrayBuffer())
      setFileName(file.name); setRows(parsed); setParseErrors(errors)
      if (!parsed.length) {
        toast({ title: 'Nothing to ingest', description: errors[0] ?? 'No valid rows found.', variant: 'destructive' })
      }
    } catch (e) {
      setRows([]); setParseErrors([])
      toast({ title: 'Could not read file', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    }
  }

  const handleBulkRun = async () => {
    if (!rows.length) return
    const batchId = batchIdFor(fileName || 'sheet')
    toast({ title: 'Bulk ingestion started', description: `${rows.length} items — track it under Ingestion status.` })
    await bulk.run(rows, batchId, onProgress)
  }

  const handleSubmit = async () => {
    if (!form.product_url.trim()) return
    setLoading(true)
    try {
      const payload = { ...form }
      if (!payload.v_ton_model) delete payload.v_ton_model
      const res = await v2Api.submit(payload)
      toast({ title: 'Job submitted', description: res.job_id })
      setForm(EMPTY)
      onOpenChange(false)
      onSuccess(res.job_id)
    } catch (e) {
      if (e instanceof DuplicateJobError) {
        const desc = e.kind === 'already_ingested'
          ? `Already ingested${e.productId ? ` as product ${e.productId}` : ''} — highlighting the original`
          : 'A job for this URL is already running — highlighting it'
        toast({ title: e.kind === 'already_ingested' ? 'Already ingested' : 'Already in queue', description: desc })
        onOpenChange(false)
        if (e.existingJobId) onDuplicate(e.existingJobId)
      } else {
        toast({ title: 'Submit failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] max-h-[84vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Add items</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="manual" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="h-8 w-fit">
            <TabsTrigger value="manual" className="text-xs">Manual</TabsTrigger>
            <TabsTrigger value="excel" className="text-xs">Excel upload</TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="flex-1 overflow-y-auto flex flex-col gap-3 mt-3 pr-1">
            <div className="grid gap-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Link *</Label>
              <Input placeholder="https://…" value={form.product_url} onChange={e => set('product_url', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Gender *</Label>
                <Select value={form.product_gender_type} onValueChange={v => set('product_gender_type', v as SubmitJobBody['product_gender_type'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="unisex">Unisex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Complexity *</Label>
                <Select value={form.product_complexity} onValueChange={v => set('product_complexity', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="simple">Simple</SelectItem>
                    <SelectItem value="complex">Complex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Category *</Label>
                <Select value={form.product_type} onValueChange={v => set('product_type', v as SubmitJobBody['product_type'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="topwear">Topwear</SelectItem>
                    <SelectItem value="bottomwear">Bottomwear</SelectItem>
                    <SelectItem value="dress">Dress</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Sub-category *</Label>
                <Input placeholder="e.g. cargo trousers" value={form.product_sub_type} onChange={e => set('product_sub_type', e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm">HITL required</p>
                <p className="text-xs text-muted-foreground">Pause after identification for review</p>
              </div>
              <Switch checked={!!form.hitl_post_identification} onCheckedChange={v => set('hitl_post_identification', v)} />
            </div>

            <div className="border-t border-dashed border-border pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Optional</p>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">VTon model override</Label>
                <Select value={form.v_ton_model || 'auto'} onValueChange={v => set('v_ton_model', v === 'auto' ? '' : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="auto">Auto (from complexity)</SelectItem>
                    <SelectItem value="fashn_vton">fashn_vton</SelectItem>
                    <SelectItem value="seedream">seedream</SelectItem>
                    <SelectItem value="gemini_nano_banana">gemini_nano_banana</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleSubmit} disabled={loading || !form.product_url.trim()}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Add item
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="excel" className="flex-1 overflow-y-auto flex flex-col gap-3 mt-3">
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault(); setDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void handleFile(f)
              }}
              className={`rounded-lg border border-dashed py-8 text-center transition-colors ${dragging ? 'border-primary bg-muted/50' : 'border-border'}`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={bulk.isRunning}
                className="flex w-full flex-col items-center justify-center gap-2 disabled:opacity-60"
              >
                <UploadCloud className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {fileName || 'Drop .xlsx here or browse'}
                </span>
              </button>
            </div>

            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5 self-start">
              <Download className="h-3.5 w-3.5" /> Download template
            </Button>
            <p className="text-[10px] text-muted-foreground -mt-1.5">
              Columns: S.No · gender · category (topwear/bottomwear/dress) · sub-category · url.
              Every bulk item is ingested as <strong>complex</strong> and pauses for review before placement.
            </p>

            {parseErrors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 max-h-28 overflow-y-auto">
                <p className="text-[11px] font-semibold text-destructive">{parseErrors.length} row(s) skipped</p>
                <ul className="mt-0.5 space-y-0.5">
                  {parseErrors.slice(0, 20).map((er, i) => (
                    <li key={i} className="text-[10px] text-muted-foreground">{er}</li>
                  ))}
                </ul>
              </div>
            )}

            {rows.length > 0 && (
              <p className="text-xs">
                <strong>{rows.length}</strong> valid row(s) ready — submitted 3 at a time, each batch
                finishing before the next, with up to 3 retries from the step that failed.
              </p>
            )}

            {bulk.state.phase !== 'idle' && (
              <div className="rounded-md border border-border p-2 text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground capitalize">{bulk.state.phase}</p>
                <p>{bulk.state.message}</p>
                <p className="mt-1">
                  submitted {bulk.state.submitted}/{bulk.state.total}
                  {bulk.state.duplicates > 0 && ` · ${bulk.state.duplicates} already in queue`}
                  {bulk.state.failedToSubmit > 0 && ` · ${bulk.state.failedToSubmit} rejected`}
                </p>
              </div>
            )}

            <DialogFooter className="gap-2">
              {bulk.isRunning ? (
                <Button variant="outline" onClick={bulk.stop}>Stop</Button>
              ) : null}
              <Button onClick={handleBulkRun} disabled={!rows.length || bulk.isRunning}>
                {bulk.isRunning && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Ingest rows
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
    {dialog}
    </>
  )
}
