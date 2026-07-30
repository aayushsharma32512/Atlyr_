import { useState } from 'react'
import { Loader2, UploadCloud } from 'lucide-react'
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

// Complexity and the VTON model are no longer operator choices — every job is submitted as
// complex and routed to gemini_nano_banana. product_complexity is still required by
// POST /jobs (submit.ts: z.string().min(1)), so it's pinned here rather than dropped.
const FIXED_COMPLEXITY = 'complex'
const FIXED_VTON_MODEL = 'gemini_nano_banana'

const EMPTY: SubmitJobBody = {
  product_url: '',
  product_gender_type: 'female',
  product_type: 'topwear',
  product_sub_type: '',
  product_complexity: FIXED_COMPLEXITY,
  v_ton_model: FIXED_VTON_MODEL,
  hitl_post_identification: false,
  // On by default — operators verify/erase the segmented garment before placement.
  hitl_post_segmentation: true,
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (jobId: string) => void
  onDuplicate: (existingJobId: string) => void
}

export function AddItemDialog({ open, onOpenChange, onSuccess, onDuplicate }: Props) {
  const [form, setForm] = useState<SubmitJobBody>(EMPTY)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const { notify, dialog } = useNotWiredDialog()

  const set = <K extends keyof SubmitJobBody>(k: K, v: SubmitJobBody[K]) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.product_url.trim()) return
    setLoading(true)
    try {
      const res = await v2Api.submit({ ...form })
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

            <DialogFooter>
              <Button onClick={handleSubmit} disabled={loading || !form.product_url.trim()}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Add item
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="excel" className="flex-1 overflow-y-auto flex flex-col gap-3 mt-3">
            <button
              onClick={() => notify('Excel batch ingestion', 'Bulk submit only supports one URL at a time today — POST /jobs takes a single product_url.')}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-center hover:bg-muted/40 transition-colors"
            >
              <UploadCloud className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Drop .xlsx here or browse</span>
            </button>
            <DialogFooter>
              <Button disabled>Ingest rows</Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
    {dialog}
    </>
  )
}
