import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { supabase } from '@/integrations/supabase/client'
import { V2_STORAGE_BUCKET, type PipelineJob, type StepArtifact } from '@/utils/ingestionV2Api'

function storageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const { data } = supabase.storage.from(V2_STORAGE_BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

function AccordionItem({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted text-sm font-medium hover:bg-muted/80 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          {title}
        </div>
        {badge}
      </button>
      {open && (
        <div className="px-4 py-3 border-t border-border bg-background text-sm">
          {children}
        </div>
      )}
    </div>
  )
}

function StepBadge({ done }: { done: boolean }) {
  return done
    ? <Badge variant="outline" className="text-[10px] text-green-500 border-green-500/40">✓ Done</Badge>
    : <Badge variant="outline" className="text-[10px] text-muted-foreground">Pending</Badge>
}

type Props = { job: PipelineJob; artifacts: StepArtifact[] }

export function StepDetailsAccordion({ job, artifacts }: Props) {
  const byType = (type: string) => artifacts.filter(a => a.artifact_type === type)
  const firstByType = (type: string) => artifacts.find(a => a.artifact_type === type)

  const rawImages = byType('raw_image')
  const crawlMeta = firstByType('crawl_meta')
  const classifications = byType('image_classification')
  const vtonSelection = firstByType('vton_image_selection')
  const garmentSummary = firstByType('garment_summary')
  const vtonImage = firstByType('vton_image')

  const hasScraping = rawImages.length > 0
  const hasIdentification = classifications.length > 0
  const hasGarmentSummary = !!garmentSummary
  const hasVton = !!vtonImage || !!job.vton_image_url
  const hasSegmented = !!job.segmented_image_url

  return (
    <div className="flex flex-col gap-2">

      {/* Scraping */}
      <AccordionItem title="Step 2 — Scraping" badge={<StepBadge done={hasScraping} />}>
        {rawImages.length > 0 ? (
          <>
            <div className="grid grid-cols-6 gap-2 mb-3">
              {rawImages.map((img, i) => {
                const url = storageUrl(img.storage_path)
                return (
                  <div key={i} className="aspect-square rounded bg-muted overflow-hidden">
                    {url ? <img src={url} alt={`raw-${i}`} className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
                  </div>
                )
              })}
            </div>
            {crawlMeta?.data && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground mb-1">crawl_meta</summary>
                <pre className="bg-muted rounded p-2 overflow-auto max-h-40 text-[10px]">
                  {JSON.stringify(crawlMeta.data, null, 2)}
                </pre>
              </details>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No images scraped yet.</p>
        )}
      </AccordionItem>

      {/* Identification */}
      <AccordionItem title="Step 3 — Identification" badge={<StepBadge done={hasIdentification} />}>
        {classifications.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Img</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Stage 2 Winner</TableHead>
                <TableHead>Selected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classifications.map((c, i) => {
                const url = (c.data?.public_url as string | undefined) ?? storageUrl(c.storage_path)
                const category = c.data?.category as string | undefined
                const stage2Winner = c.data?.stage2_winner as string | undefined
                const uncertain = c.data?.uncertain as boolean | undefined
                // v_ton_preferred_image is a public URL, compare against data.public_url
                const isSelected = !!job.v_ton_preferred_image
                  && (c.data?.public_url as string | undefined) === job.v_ton_preferred_image
                return (
                  <TableRow key={i} className={cn(isSelected && 'bg-green-500/5')}>
                    <TableCell>
                      {url
                        ? <img src={url} alt="" className="h-9 w-9 rounded object-cover" />
                        : <div className="h-9 w-9 rounded bg-muted" />
                      }
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{category ?? '—'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {stage2Winner ?? '—'}
                      {uncertain && <span className="ml-1 text-amber-500">?</span>}
                    </TableCell>
                    <TableCell>
                      {isSelected && <span className="text-xs text-green-500 font-medium">✓ Selected</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-xs text-muted-foreground">Identification not run yet.</p>
        )}
      </AccordionItem>

      {/* Garment Summary */}
      <AccordionItem title="Step 4 — Garment Summary" badge={<StepBadge done={hasGarmentSummary} />}>
        {garmentSummary?.data ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(garmentSummary.data)
                .filter(([k]) => !['model', 'prompt_version', 'view'].includes(k))
                .map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{k.replace(/_/g, ' ')}</p>
                    <p className="text-xs">{String(v)}</p>
                  </div>
                ))}
            </div>
            <div className="flex gap-2 mt-3">
              {garmentSummary.data.model && <Badge variant="outline" className="text-[10px]">{String(garmentSummary.data.model)}</Badge>}
              {garmentSummary.data.prompt_version && <Badge variant="outline" className="text-[10px]">prompt {String(garmentSummary.data.prompt_version)}</Badge>}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Garment summary not generated yet.</p>
        )}
      </AccordionItem>

      {/* VTon Generation */}
      <AccordionItem title="Step 5 — VTon Generation" badge={<StepBadge done={hasVton} />}>
        {vtonImage?.data || job.vton_image_url ? (
          <div className="flex gap-4">
            {job.vton_image_url && (
              <img src={job.vton_image_url} alt="vton" className="h-28 w-auto rounded border border-border object-contain" />
            )}
            <div className="flex flex-col gap-1.5 text-xs">
              {vtonImage?.data?.model_used && <div><span className="text-muted-foreground">Model: </span>{String(vtonImage.data.model_used)}</div>}
              {vtonImage?.data?.inference_ms && <div><span className="text-muted-foreground">Inference: </span>{String(vtonImage.data.inference_ms)}ms</div>}
              {job.vton_image_url && <div><span className="text-muted-foreground">URL: </span><span className="text-muted-foreground/70 break-all">{job.vton_image_url}</span></div>}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">VTon not generated yet.</p>
        )}
      </AccordionItem>

      {/* Segmentation */}
      <AccordionItem title="Step 6 — Segmentation" badge={<StepBadge done={hasSegmented} />}>
        {job.segmented_image_url ? (
          <div className="flex gap-4">
            <img src={job.segmented_image_url} alt="segmented" className="h-28 w-auto rounded border border-border object-contain" />
            <div className="text-xs text-muted-foreground break-all">{job.segmented_image_url}</div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {['segmenting', 'segmented'].includes(job.current_state) || job.current_state.includes('segmen')
              ? 'Segmentation in progress…'
              : 'Segmentation not started yet.'}
          </p>
        )}
      </AccordionItem>

    </div>
  )
}
