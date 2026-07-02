import { useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/integrations/supabase/client'
import { V2_STORAGE_BUCKET, type PipelineJob, type StepArtifact } from '@/utils/ingestionV2Api'

function storageUrl(path: string | null): string | null {
  if (!path) return null
  const { data } = supabase.storage.from(V2_STORAGE_BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

function ImageSlot({ label, url, note, badge }: { label: string; url: string | null; note?: string; badge?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="aspect-[3/4] rounded-lg border border-border bg-muted overflow-hidden relative flex items-center justify-center">
        {url ? (
          <>
            <img src={url} alt={label} className="w-full h-full object-contain" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-1.5 right-1.5 bg-black/60 rounded p-1 opacity-0 hover:opacity-100 transition-opacity"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3 text-white" />
            </a>
          </>
        ) : (
          <p className="text-xs text-muted-foreground text-center px-2">Not yet</p>
        )}
        {badge && (
          <span className="absolute top-1.5 left-1.5 bg-black/70 text-[9px] text-white px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs font-medium">{label}</p>
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
    </div>
  )
}

type Props = {
  job: PipelineJob
  artifacts: StepArtifact[]
}

export function ImagePreviewStrip({ job, artifacts }: Props) {
  const [rawIndex, setRawIndex] = useState(0)

  const rawImages = artifacts.filter(a => a.artifact_type === 'raw_image')
  const vtonSelection = artifacts.find(a => a.artifact_type === 'vton_image_selection')
  const vtonImage = artifacts.find(a => a.artifact_type === 'vton_image')

  // raw_image: URL lives in data.public_url (storage_path is also valid but data.public_url is authoritative)
  const rawUrl = (rawImages[rawIndex]?.data?.public_url as string | undefined)
    ?? storageUrl(rawImages[rawIndex]?.storage_path ?? null)
  // vton_image_selection: storage_path is null — URL is in data.public_url
  // v_ton_preferred_image on the job is also a public URL (not a storage path)
  const vtonEligibleUrl = (vtonSelection?.data?.public_url as string | undefined)
    ?? job.v_ton_preferred_image
    ?? null
  const vtonGenUrl = job.vton_image_url ?? (vtonImage?.data?.public_url as string | undefined) ?? null
  const segmentedUrl = job.segmented_image_url

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Output Preview</p>
      <div className="grid grid-cols-4 gap-3">

        {/* Submitted */}
        <div className="flex flex-col gap-1.5">
          <div className="aspect-[3/4] rounded-lg border border-border bg-muted overflow-hidden relative flex items-center justify-center">
            {rawUrl ? (
              <img src={rawUrl} alt="Submitted" className="w-full h-full object-contain" />
            ) : (
              <p className="text-xs text-muted-foreground text-center px-2">Not yet</p>
            )}
            {rawImages.length > 0 && (
              <span className="absolute top-1.5 left-1.5 bg-black/70 text-[9px] text-white px-1.5 py-0.5 rounded">
                {rawImages.length} imgs
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Submitted</p>
            {rawImages.length > 1 && (
              <div className="flex gap-0.5">
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRawIndex(i => Math.max(0, i - 1))} disabled={rawIndex === 0}>
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRawIndex(i => Math.min(rawImages.length - 1, i + 1))} disabled={rawIndex === rawImages.length - 1}>
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">{rawImages.length > 0 ? `${rawImages.length} scraped` : 'Pending scrape'}</p>
        </div>

        <ImageSlot
          label="VTon Eligible"
          url={vtonEligibleUrl}
          note={(vtonSelection?.data?.category as string | undefined) ?? 'Selected by SigLIP'}
          badge={vtonSelection?.data?.uncertain ? '?' : undefined}
        />

        <ImageSlot
          label="VTon Generated"
          url={vtonGenUrl}
          note={vtonImage?.data?.model_used as string ?? job.v_ton_model ?? undefined}
        />

        <ImageSlot
          label="Segmented"
          url={segmentedUrl}
          note={segmentedUrl ? 'Final output' : undefined}
        />
      </div>
    </div>
  )
}
