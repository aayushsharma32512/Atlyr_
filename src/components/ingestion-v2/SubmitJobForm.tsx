import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { useToast } from '@/hooks/use-toast'
import { v2Api, type SubmitJobBody } from '@/utils/ingestionV2Api'

const EMPTY: SubmitJobBody = {
  product_url: '',
  product_gender_type: 'female',
  product_type: 'topwear',
  product_sub_type: '',
  product_complexity: 'simple',
  v_ton_model: '',
  hitl_post_identification: false,
  // On by default — operators verify/erase the segmented garment before placement.
  hitl_post_segmentation: true,
}

type Props = { onSuccess: (jobId: string) => void }

export function SubmitJobForm({ onSuccess }: Props) {
  const [form, setForm] = useState<SubmitJobBody>(EMPTY)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const set = <K extends keyof SubmitJobBody>(k: K, v: SubmitJobBody[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.product_url.trim()) return
    setLoading(true)
    try {
      const payload: SubmitJobBody = { ...form }
      if (!payload.v_ton_model) delete payload.v_ton_model
      const res = await v2Api.submit(payload)
      toast({ title: 'Job submitted', description: res.job_id })
      setForm(EMPTY)
      onSuccess(res.job_id)
    } catch (e) {
      toast({ title: 'Submit failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Submit New Ingestion Job</DrawerTitle>
        <DrawerDescription>Scrape, classify, generate VTon and segment a product.</DrawerDescription>
      </DrawerHeader>

      <div className="flex flex-col gap-4 px-4 pb-2 overflow-y-auto flex-1">
        {/* URL */}
        <div className="grid gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Product URL *</Label>
          <Input
            placeholder="https://myntra.com/product/..."
            value={form.product_url}
            onChange={e => set('product_url', e.target.value)}
          />
        </div>

        {/* Gender + Type */}
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Gender</Label>
            <Select value={form.product_gender_type} onValueChange={v => set('product_gender_type', v as SubmitJobBody['product_gender_type'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="unisex">Unisex</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Product Type</Label>
            <Select value={form.product_type} onValueChange={v => set('product_type', v as SubmitJobBody['product_type'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="topwear">Topwear</SelectItem>
                <SelectItem value="bottomwear">Bottomwear</SelectItem>
                <SelectItem value="dress">Dress</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Sub type */}
        <div className="grid gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Sub Type</Label>
          <Input
            placeholder="e.g. oversized knit sweater, cargo trousers…"
            value={form.product_sub_type}
            onChange={e => set('product_sub_type', e.target.value)}
          />
        </div>

        {/* Complexity + VTon model */}
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Complexity</Label>
            <Select value={form.product_complexity} onValueChange={v => set('product_complexity', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="simple">Simple → fashn_vton</SelectItem>
                <SelectItem value="complex">Complex → seedream</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">VTon Model Override</Label>
            <Select value={form.v_ton_model || 'auto'} onValueChange={v => set('v_ton_model', v === 'auto' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (from complexity)</SelectItem>
                <SelectItem value="fashn_vton">fashn_vton</SelectItem>
                <SelectItem value="seedream">seedream</SelectItem>
                <SelectItem value="gemini_nano_banana">gemini_nano_banana</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* HITL gates */}
        <div className="grid gap-2 pt-1">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">HITL Gates</Label>
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm">Review after Identification</p>
              <p className="text-xs text-muted-foreground">Pause after SigLIP classification</p>
            </div>
            <Switch
              checked={!!form.hitl_post_identification}
              onCheckedChange={v => set('hitl_post_identification', v)}
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm">Review after Segmentation</p>
              <p className="text-xs text-muted-foreground">Pause to review segmented image</p>
            </div>
            <Switch
              checked={!!form.hitl_post_segmentation}
              onCheckedChange={v => set('hitl_post_segmentation', v)}
            />
          </div>
        </div>
      </div>

      <DrawerFooter>
        <Button onClick={handleSubmit} disabled={loading || !form.product_url.trim()}>
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Submit Job
        </Button>
        <DrawerClose asChild>
          <Button variant="outline">Cancel</Button>
        </DrawerClose>
      </DrawerFooter>
    </>
  )
}
