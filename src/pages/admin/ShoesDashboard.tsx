import { useEffect, useMemo, useState } from 'react'
import { Check, Download, Eraser, Rocket, Trash2, Upload } from 'lucide-react'
import { AppShellLayout } from '@/layouts/AppShellLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useIngestionV2Jobs } from '@/hooks/useIngestionV2Jobs'
import { useSourceImages } from '@/components/ingestion-automated/useSourceImages'
import { usePlacementImage } from '@/components/ingestion-automated/usePlacementImage'
import { useCatalogStatus } from '@/components/ingestion-automated/useCatalogStatus'
import { PlacementMeshEditor } from '@/components/ingestion-automated/PlacementMeshEditor'
import { SegmentEraserDialog } from '@/components/ingestion-automated/SegmentEraserDialog'
import { PhotoViewerDialog, type ViewerImage } from '@/components/ingestion-automated/PhotoViewerDialog'
import { PhotoCard, type TileState } from '@/components/ingestion-automated/PhotoCard'
import { ConfirmDialog } from '@/components/ingestion-automated/ConfirmDialog'
import { STATE_LABELS, STATE_VARIANTS } from '@/components/ingestion-v2/constants'
import { attentionNote } from '@/components/ingestion-automated/stateMapping'
import { v2Api, DuplicateJobError, type PipelineJob } from '@/utils/ingestionV2Api'

/**
 * The manual asset lane, driven one product at a time.
 *
 * Shoes have no automated path: SigLIP's vocabulary is garment wording and the VTON prompt bank
 * has no footwear entry, so identification, try-on and segmentation are all done by a person.
 *
 * Laid out to match the ingestion-automated dashboard on purpose — same PhotoCard tiles, same
 * eraser, same left-to-right reading of scraped → try-on → cut-out → placed. An operator moving
 * between the two screens should not have to learn a second vocabulary; the only real difference
 * is that here the middle two tiles are filled by a person rather than by a GPU.
 */

const GATE_ORDER = [
  'awaiting_manual_identification',
  'awaiting_manual_vton',
  'awaiting_manual_segmentation',
  'awaiting_manual_placement',
] as const

type Gate = typeof GATE_ORDER[number]

/** Read a picked file as base64 without the data: prefix — the shape both upload routes take. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''))
    reader.readAsDataURL(file)
  })
}

/**
 * Force a real download rather than a navigation. A bare `download` attribute is ignored on a
 * cross-origin href, so a Supabase public URL would merely open the image in a tab — fetching it
 * to a blob first is what actually puts the file on disk, which is the whole point of this step.
 */
async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const blobUrl = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}

/**
 * Re-encode the try-on as an RGBA PNG so it can seed the cut-out slot.
 *
 * This is what lets an operator skip Photoshop entirely and cut out with our own eraser: the
 * eraser edits whatever sits at segmented_image_url, so we copy the try-on there first and hand it
 * straight to the eraser. Two details make it work — `crossOrigin` keeps the canvas untainted (the
 * eraser relies on the same thing), and a canvas always exports colour type 6, which is what
 * satisfies the upload route's insistence on a real alpha channel. Nothing is erased yet; the
 * pixels are identical to the try-on until the operator starts painting.
 */
async function tryOnToPngBase64(url: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Could not load the try-on image'))
    i.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser')
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

/** How far along the four gates a job is; -1 once it has left the lane (completed / failed). */
function gateIndex(state: string): number {
  return GATE_ORDER.indexOf(state as Gate)
}

function GateProgress({ state }: { state: string }) {
  const idx = gateIndex(state)
  const done = state === 'completed'
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {GATE_ORDER.map((g, i) => (
        <span
          key={g}
          className={`h-1.5 w-8 rounded-full ${
            done || (idx >= 0 && i < idx) ? 'bg-emerald-500' : idx === i ? 'bg-amber-500' : 'bg-muted'
          }`}
        />
      ))}
    </div>
  )
}

/** A button that opens a file picker and reports the chosen file as base64. */
function UploadButton({
  label,
  accept,
  busy,
  variant = 'default',
  onPick,
}: {
  label: string
  accept: string
  busy: boolean
  variant?: 'default' | 'secondary' | 'outline'
  onPick: (base64: string) => void
}) {
  return (
    <label className="inline-flex">
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          // Reset immediately so re-picking the SAME file still fires a change event — the common
          // case when an operator fixes a rejected export and uploads it again.
          e.target.value = ''
          if (!file) return
          onPick(await fileToBase64(file))
        }}
      />
      <Button
        size="sm"
        variant={variant}
        disabled={busy}
        onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement | null)?.click()}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        {busy ? 'Uploading…' : label}
      </Button>
    </label>
  )
}

export default function ShoesDashboard() {
  const { toast } = useToast()
  const { jobs, loading, error, refetch } = useIngestionV2Jobs()

  const manualJobs = useMemo(
    () =>
      jobs
        .filter((j) => j.asset_lane === 'manual')
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs],
  )

  const sourceImages = useSourceImages(manualJobs)
  const { placements, refetch: refetchPlacements } = usePlacementImage(manualJobs)
  // Completing the lane does NOT put a shoe in the catalog. The automated pipeline stages a job
  // from inside placement.handler, which this lane never runs — every gate is a HITL state, so no
  // handler executes. Publishing is therefore an explicit step here, exactly as it is on the
  // ingestion dashboard, and this is what tells the operator whether it has happened.
  const { statuses: catalogStatuses, refetch: refetchCatalog } = useCatalogStatus(manualJobs)

  const [url, setUrl] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | 'unisex'>('unisex')
  const [subType, setSubType] = useState('sneakers')
  const [submitting, setSubmitting] = useState(false)
  const [busyJob, setBusyJob] = useState<string | null>(null)
  const [meshJobId, setMeshJobId] = useState<string | null>(null)
  const [eraserJobId, setEraserJobId] = useState<string | null>(null)
  // Set while a seed upload is in flight. The eraser cannot open until the job actually carries a
  // segmented_image_url, and refetch() is fire-and-forget, so we wait for the value to appear
  // rather than racing the poll and opening the dialog on a job with nothing to edit.
  const [pendingEraserJobId, setPendingEraserJobId] = useState<string | null>(null)
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null)

  const byId = (id: string | null) => manualJobs.find((j) => j.job_id === id) ?? null

  useEffect(() => {
    if (!pendingEraserJobId) return
    if (manualJobs.find((j) => j.job_id === pendingEraserJobId)?.segmented_image_url) {
      setEraserJobId(pendingEraserJobId)
      setPendingEraserJobId(null)
    }
  }, [pendingEraserJobId, manualJobs])

  const fail = (e: unknown) =>
    toast({ variant: 'destructive', title: 'Failed', description: e instanceof Error ? e.message : String(e) })

  async function submit() {
    if (!url.trim()) return
    setSubmitting(true)
    try {
      await v2Api.submit({
        product_url: url.trim(),
        product_gender_type: gender,
        product_type: 'footwear',
        product_sub_type: subType.trim() || 'shoes',
        product_complexity: 'simple',
        // The server rejects footwear on the automated lane, so this is not merely a default.
        asset_lane: 'manual',
      })
      setUrl('')
      toast({ title: 'Submitted', description: 'Scraping has started.' })
      refetch()
    } catch (e) {
      if (e instanceof DuplicateJobError) {
        toast({ variant: 'destructive', title: 'Already in the pipeline', description: e.message })
      } else fail(e)
    } finally {
      setSubmitting(false)
    }
  }

  /** Every gate advances the same way; only what it uploads first differs. */
  async function runStep(jobId: string, work: () => Promise<unknown>, done: string) {
    setBusyJob(jobId)
    try {
      await work()
      toast({ title: done })
      refetch()
    } catch (e) {
      fail(e)
    } finally {
      setBusyJob(null)
    }
  }

  /**
   * Copy the try-on into the cut-out slot and open the eraser on it — the "do it here instead of
   * in Photoshop" path. Safe to run again on a job that already has a cut-out: it overwrites with a
   * fresh copy of the try-on, which is the only sane meaning of starting the cut-out over.
   */
  function eraseFromTryOn(job: PipelineJob) {
    if (!job.vton_image_url) return
    runStep(
      job.job_id,
      async () => {
        const b64 = await tryOnToPngBase64(job.vton_image_url!)
        await v2Api.uploadManualSegmented(job.job_id, b64)
        setPendingEraserJobId(job.job_id)
      },
      'Try-on copied — opening the eraser',
    )
  }

  /** The tile strip: scraped → try-on → cut-out → placed, mirroring RowItem's Gen/Sgmtd/Placed. */
  function renderTiles(job: PipelineJob) {
    const busy = busyJob === job.job_id
    const idx = gateIndex(job.current_state)
    const scraped = sourceImages[job.job_id] ?? []
    const placed = placements[job.job_id]?.url
    const atPick = job.current_state === 'awaiting_manual_identification'
    const preferred = job.v_ton_preferred_image

    // A tile is 'processing' only while the step that fills it is the one in flight; everything
    // downstream of the current gate reads 'empty' so the row never implies work is happening.
    const tile = (filled: unknown, ownGate: Gate): TileState =>
      filled ? 'available' : job.current_state === ownGate ? 'processing' : 'empty'

    const openViewer = (images: ViewerImage[], i: number) => setViewer({ images, index: i })

    return (
      <div className="mt-3 flex flex-wrap items-start gap-3">
        {/* Scraped photos — the audit view, and the pick surface at the first gate. */}
        {scraped.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1.5">
              {scraped.slice(0, 8).map((src, i) => (
                <PhotoCard
                  key={src}
                  label=""
                  size="sm"
                  state="available"
                  url={src}
                  badge={src === preferred ? '✓' : undefined}
                  onExpand={() => openViewer(scraped.map((u) => ({ url: u, label: 'Scraped' })), i)}
                  actions={
                    atPick
                      ? [{
                          icon: <Check className="h-3 w-3" />,
                          label: 'Use this photo',
                          onClick: () =>
                            runStep(job.job_id, () => v2Api.proceed(job.job_id, { vton_image_override: src }), 'Photo picked'),
                        }]
                      : undefined
                  }
                />
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">
              Scraped{atPick ? ' — hover a photo and tick the one to keep' : ''}
            </span>
          </div>
        )}

        <PhotoCard
          label="Try-on"
          size="xl"
          state={tile(job.vton_image_url, 'awaiting_manual_vton')}
          url={job.vton_image_url}
          note={
            job.vton_image_url
              ? undefined
              : idx === 1
                ? 'Upload the try-on'
                : idx < 1
                  ? 'Waiting on photo pick'
                  : undefined
          }
          onExpand={
            job.vton_image_url
              ? () => openViewer([{ url: job.vton_image_url!, label: 'Try-on (uploaded)' }], 0)
              : undefined
          }
          actions={
            job.vton_image_url
              ? [
                  {
                    icon: <Eraser className="h-3 w-3" />,
                    label: 'Cut out here with the eraser',
                    onClick: () => eraseFromTryOn(job),
                  },
                  {
                    icon: <Download className="h-3 w-3" />,
                    label: 'Download for Photoshop',
                    onClick: () =>
                      downloadUrl(job.vton_image_url!, `${job.job_id.slice(0, 8)}-tryon.png`).catch(fail),
                  },
                ]
              : undefined
          }
        />

        <PhotoCard
          label="Cut-out"
          size="xl"
          state={tile(job.segmented_image_url, 'awaiting_manual_segmentation')}
          url={job.segmented_image_url}
          note={
            job.segmented_image_url
              ? 'Click ✎ to erase (HITL)'
              : idx === 2
                ? 'Upload the transparent PNG'
                : idx < 2
                  ? 'Waiting on try-on'
                  : undefined
          }
          onExpand={job.segmented_image_url ? () => setEraserJobId(job.job_id) : undefined}
          actions={
            job.segmented_image_url
              ? [{ icon: <Eraser className="h-3 w-3" />, label: 'AI eraser', onClick: () => setEraserJobId(job.job_id) }]
              : undefined
          }
        />

        {/* ml-auto parks the final output hard right, away from the intermediate steps. */}
        <div className="ml-auto shrink-0">
          <PhotoCard
            label="Placed"
            size="xl"
            state={placed ? 'available' : job.current_state === 'awaiting_manual_placement' ? 'processing' : 'empty'}
            url={placed}
            note={placed ? undefined : idx === 3 ? 'Open the placement editor' : 'Waiting on cut-out'}
            onExpand={job.segmented_image_url && !busy ? () => setMeshJobId(job.job_id) : undefined}
          />
        </div>
      </div>
    )
  }

  /** The one action the current gate needs, under the tiles. */
  function renderAction(job: PipelineJob) {
    const busy = busyJob === job.job_id
    const advance = () => runStep(job.job_id, () => v2Api.proceed(job.job_id), 'Moved to the next step')

    switch (job.current_state) {
      case 'awaiting_manual_vton':
        return (
          <>
            <UploadButton
              label={job.vton_image_url ? 'Replace try-on' : 'Upload try-on'}
              accept="image/png,image/jpeg"
              busy={busy}
              variant={job.vton_image_url ? 'outline' : 'default'}
              onPick={(b64) => runStep(job.job_id, () => v2Api.uploadManualVton(job.job_id, b64), 'Try-on uploaded')}
            />
            {job.vton_image_url && (
              <Button size="sm" disabled={busy} onClick={advance}>Continue</Button>
            )}
          </>
        )

      case 'awaiting_manual_segmentation':
        return (
          <>
            {job.vton_image_url && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadUrl(job.vton_image_url!, `${job.job_id.slice(0, 8)}-tryon.png`).catch(fail)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download try-on
              </Button>
            )}
            <UploadButton
              label={job.segmented_image_url ? 'Replace cut-out' : 'Upload cut-out'}
              accept="image/png"
              busy={busy}
              variant={job.segmented_image_url ? 'outline' : 'default'}
              onPick={(b64) => runStep(job.job_id, () => v2Api.uploadManualSegmented(job.job_id, b64), 'Cut-out uploaded')}
            />
            {/* The no-Photoshop route: seed the cut-out from the try-on and erase it in place. */}
            {job.vton_image_url && (
              <Button
                size="sm"
                variant={job.segmented_image_url ? 'outline' : 'default'}
                disabled={busy}
                onClick={() => eraseFromTryOn(job)}
                title="Copy the try-on into the cut-out slot and open our eraser on it"
              >
                <Eraser className="mr-1.5 h-3.5 w-3.5" />
                {job.segmented_image_url ? 'Re-cut with eraser' : 'Cut out with eraser'}
              </Button>
            )}
            {job.segmented_image_url && (
              <Button size="sm" disabled={busy} onClick={advance}>Continue</Button>
            )}
          </>
        )

      case 'awaiting_manual_placement':
        return (
          <>
            <Button size="sm" disabled={busy || !job.segmented_image_url} onClick={() => setMeshJobId(job.job_id)}>
              Place on mannequin
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={advance}>Mark done</Button>
          </>
        )

      case 'completed': {
        const status = catalogStatuses[job.job_id]
        if (status === 'live') {
          return <span className="text-xs text-emerald-600">Live in the catalog</span>
        }
        return (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                runStep(job.job_id, async () => { await v2Api.publish(job.job_id); refetchCatalog() }, 'Published to the catalog')
              }
              title="Stage into ingested_products and promote to the live products table"
            >
              <Rocket className="mr-1.5 h-3.5 w-3.5" />
              {status === 'staged' ? 'Publish (staged)' : 'Push to catalog'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Finished, but not in the catalog until it is pushed.
            </span>
          </>
        )
      }

      default:
        return null
    }
  }

  return (
    <AppShellLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Shoes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Footwear is ingested by hand: paste a link, pick a photo, then upload the try-on and the
            Photoshop cut-out. Nothing here is generated.
          </p>
        </header>

        <section className="mb-8 rounded-lg border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[18rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Product URL</label>
              <Input
                value={url}
                placeholder="https://…"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Gender</label>
              <Select value={gender} onValueChange={(v) => setGender(v as typeof gender)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unisex">Unisex</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Sub-type</label>
              <Input value={subType} onChange={(e) => setSubType(e.target.value)} className="w-36" />
            </div>
            <Button onClick={submit} disabled={submitting || !url.trim()}>
              {submitting ? 'Submitting…' : 'Add'}
            </Button>
          </div>
        </section>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 w-full" />)}</div>
        ) : manualJobs.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No shoes yet. Paste a product link above to start one.
          </p>
        ) : (
          <ul className="space-y-3">
            {manualJobs.map((job) => {
              const note = attentionNote(job)
              const action = renderAction(job)
              return (
                <li key={job.job_id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={STATE_VARIANTS[job.current_state] ?? 'secondary'}>
                          {STATE_LABELS[job.current_state] ?? job.current_state}
                        </Badge>
                        <GateProgress state={job.current_state} />
                      </div>
                      <a
                        href={job.product_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block truncate text-sm underline underline-offset-2 hover:text-primary"
                        title={job.product_url}
                      >
                        {job.product_url}
                      </a>
                      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
                      {job.last_error && <p className="mt-1 text-xs text-destructive">{job.last_error}</p>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={busyJob === job.job_id}
                      onClick={() => setDeleteJobId(job.job_id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {renderTiles(job)}

                  {action && <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div>}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <PhotoViewerDialog
        images={viewer?.images ?? []}
        index={viewer?.index ?? 0}
        onIndexChange={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
        open={Boolean(viewer)}
        onOpenChange={(o) => { if (!o) setViewer(null) }}
      />

      {/*
        The same eraser the ingestion dashboard uses. It overwrites the object in place via
        POST /jobs/:id/segmented-image, which works here because the manual upload has already put
        a real object at `${jobId}/manual/segmented.png` and written its URL onto the job.
      */}
      <SegmentEraserDialog
        job={byId(eraserJobId)}
        open={Boolean(eraserJobId)}
        onOpenChange={(o) => { if (!o) setEraserJobId(null) }}
        onSaved={() => refetch()}
      />

      {/*
        The job-keyed placement editor, not the catalog one. It textures straight from
        job.segmented_image_url — the operator's own cut-out — so the shoe never needs to exist in
        the `products` table first, and it forwards refW/refH so a warped placement survives being
        rendered at any other resolution.
      */}
      <PlacementMeshEditor
        job={byId(meshJobId)}
        placement={meshJobId ? placements[meshJobId] : undefined}
        open={Boolean(meshJobId)}
        onOpenChange={(o) => { if (!o) setMeshJobId(null) }}
        onSaved={() => { refetchPlacements(); refetch() }}
      />

      {/*
        Deletion is total and irreversible: deleteJobCompletely drops the whole `${jobId}/` storage
        prefix (the operator's uploaded try-on and cut-out with it), the published `products` row,
        `ingested_products`, `segmentation_jobs` and the job itself. Hand-made assets cannot be
        regenerated, so this gets a real confirmation rather than an undo.
      */}
      <ConfirmDialog
        open={Boolean(deleteJobId)}
        onOpenChange={(o) => { if (!o) setDeleteJobId(null) }}
        title="Delete this shoe?"
        description={
          <>
            This removes the job, its scraped photos, the uploaded try-on and cut-out, and any
            catalog product created from it. Because the try-on and cut-out were made by hand, they
            cannot be regenerated — they would have to be redone in Photoshop.
            {byId(deleteJobId) && (
              <span className="mt-2 block truncate font-mono text-xs">{byId(deleteJobId)!.product_url}</span>
            )}
          </>
        }
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => {
          const id = deleteJobId
          setDeleteJobId(null)
          if (id) runStep(id, () => v2Api.deleteJob(id), 'Deleted')
        }}
      />
    </AppShellLayout>
  )
}
