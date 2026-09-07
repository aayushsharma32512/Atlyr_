import { supabase } from '@/integrations/supabase/client'

const BASE = (import.meta.env as Record<string, string>).VITE_INGESTION_V2_API_URL ?? 'http://localhost:3001'

// Real session token, not a shared secret baked into the public bundle.
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
  return headers
}

async function call<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: await authHeaders(),
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as T
}

// Thrown by v2Api.submit when the URL is a duplicate (409). Carries the original job/product so
// the dashboard can point at and highlight the earlier ingestion.
export class DuplicateJobError extends Error {
  kind: 'already_active' | 'already_ingested'
  existingJobId: string | null
  productId: string | null
  constructor(kind: 'already_active' | 'already_ingested', message: string, existingJobId: string | null, productId: string | null) {
    super(message)
    this.name = 'DuplicateJobError'
    this.kind = kind
    this.existingJobId = existingJobId
    this.productId = productId
  }
}

export interface PipelineJob {
  job_id: string
  product_url: string
  product_gender_type: string
  product_type: string
  product_sub_type: string
  product_complexity: string
  current_state: string
  v_ton_model: string | null
  v_ton_image_preference: { type: string } | null
  hitl_post_identification: boolean
  hitl_post_segmentation: boolean
  /**
   * Which lane produced this job's try-on and cut-out. 'manual' means an operator uploaded both by
   * hand — the footwear path, which has no automated VTON or segmentation step.
   */
  asset_lane?: 'automated' | 'manual'
  v_ton_preferred_image: string | null
  vton_image_url: string | null
  segmented_image_url: string | null
  ingested_product_id: string | null
  error_count: number
  last_error: string | null
  last_error_step: string | null
  created_by: string | null
  /** Set when the job came in through POST /batches; null for manual submissions. */
  batch_id?: string | null
  created_at: string
  updated_at: string
}

export interface StepArtifact {
  id: string
  job_id: string
  step_name: string
  artifact_type: string
  storage_path: string | null
  data: Record<string, unknown> | null
  created_at: string
}

export type SlotKey = 'front_model' | 'front_flat' | 'back_model' | 'back_flat'
export interface SlotPick { publicUrl: string; uncertain: boolean; manual: boolean }
export type SlotMapResult = Record<SlotKey, SlotPick | null>

export interface UpdateJobDetailsBody {
  product_name?: string
  brand?: string
  price?: number
  currency?: string
  product_gender_type?: 'male' | 'female' | 'unisex'
  product_type?: 'topwear' | 'bottomwear' | 'dress'
  product_sub_type?: string
  product_complexity?: string
  // Drives which of the 4 VTON slots wins when nothing's been manually retagged — see
  // pickPreferredSlot in services/ingestion-automated/src/adapters/siglip.ts. null = auto (model).
  v_ton_image_preference?: { type: 'model' | 'flat_lay' } | null
}

export interface RetagPhotoBody {
  image_url: string
  // Omit view when type is 'Detail' — a macro/texture crop has no front/back of its own.
  view?: 'Front' | 'Back' | 'Side'
  type: 'Model' | 'Flat' | 'Detail'
}

export interface SavePlacementBody {
  /** Flattened 1800x3072 composite from the mesh editor, base64 without the data: prefix. */
  image_base64: string
  transform: { scale: number; rotationDeg: number; tx: number; ty: number }
  /** Warp lattice offsets in garment geometry space, so the edit stays re-openable. */
  warp: { x: number; y: number }[]
  /** Size of the garment image the warp was measured against — see PlacementEntry.refW. */
  refW?: number
  refH?: number
}

/** One entry inside the product's `placement` JSONB map (value of a "gender:body_type" key). */
export interface PlacementEntry {
  tx: number
  ty: number
  scale: number
  rotationDeg: number
  warp: { x: number; y: number }[]
  /**
   * Pixel size of the garment image the warp offsets were authored against. The offsets are
   * absolute pixels in that space, so a renderer using any other resolution scales them by
   * texW / refW. Absent on entries written before this was recorded (renderer then assumes 1).
   */
  refW?: number
  refH?: number
}

/** Product-keyed placement save — works for both pipeline jobs and legacy catalog-only products. */
export interface SavePlacementForProductBody {
  /** Optional preview composite (1800x3072 PNG), base64 without the data: prefix. */
  image_base64?: string
  transform: { scale: number; rotationDeg: number; tx: number; ty: number }
  warp: { x: number; y: number }[]
  /** Size of the garment image the warp was measured against — see PlacementEntry.refW. */
  refW?: number
  refH?: number
  /** Mannequin the transform targets; falls back to the product's gender server-side if omitted. */
  mannequin?: 'male' | 'female'
  /** Body-type key inside the placement map; defaults to 'bodytype1' server-side. */
  body_type?: string
}

/**
 * Legacy 2D placement — the columns the SVG avatar renders from. Entirely separate from the 3D
 * transform above: different units, different renderer, saved through a different route.
 */
export interface SavePlacement2DForProductBody {
  /** Horizontal offset as a percentage of the garment's own rendered width. */
  placement_x: number
  /** Vertical offset as a percentage of the avatar's body height, measured from the chin. */
  placement_y: number
  /** Garment length in cm. */
  image_length: number
}

export interface SubmitJobBody {
  product_url: string
  product_gender_type: 'male' | 'female' | 'unisex'
  product_type: 'topwear' | 'bottomwear' | 'dress' | 'footwear'
  product_sub_type: string
  product_complexity: string
  v_ton_model?: string
  hitl_post_identification?: boolean
  hitl_post_segmentation?: boolean
  /**
   * Economy mode. 'batch' parks this job's try-on step for an AI Studio batch — roughly half the
   * cost, but results arrive minutes-to-hours later. Omitted means 'instant', and the server
   * defaults the same way, so an unaware caller can never route work into a batch.
   */
  vton_lane?: 'instant' | 'batch'
  /**
   * 'manual' replaces identification, try-on, segmentation and placement with operator gates.
   * Required when product_type is 'footwear' — the server rejects the automated combination,
   * because a shoe on the automated lane fails silently rather than loudly (SigLIP's vocabulary is
   * garment wording and the VTON prompt bank has no footwear entry).
   */
  asset_lane?: 'automated' | 'manual'
  /** Bulk uploads set this to `bulk:<sheet name>` so a batch can be tracked as a unit. */
  created_by?: string
}

// ── Server-side batches ───────────────────────────────────────────────────────

export interface SubmitBatchBody {
  label: string
  /** Kept as `bulk:<sheet>` so the dashboard's created_by grouping keeps working. */
  created_by?: string
  rows: Array<{
    product_url: string
    product_gender_type: 'male' | 'female' | 'unisex'
    product_type: 'topwear' | 'bottomwear' | 'dress'
    product_sub_type: string
  }>
  options?: {
    product_complexity?: string
    v_ton_model?: string
    hitl_post_identification?: boolean
    hitl_post_segmentation?: boolean
    /** 'batch' routes every row's VTON step through the economy lane. Server defaults to 'instant'. */
    vton_lane?: 'instant' | 'batch'
  }
}

export type BatchRowOutcome =
  | { url: string; status: 'submitted'; job_id: string }
  | { url: string; status: 'duplicate'; kind: 'already_active' | 'already_ingested' | 'in_batch'; existing_job_id: string | null }
  | { url: string; status: 'rejected'; error: string }

export interface SubmitBatchResponse {
  batch_id: string
  label: string
  submitted: number
  duplicates: number
  rejected: number
  outcomes: BatchRowOutcome[]
}

export interface BatchJobSummary {
  job_id: string
  product_url: string
  current_state: string
  error_count: number
  last_error_step: string | null
  updated_at: string
}

export interface BatchStatusResponse {
  batch: { batch_id: string; label: string; created_by: string | null; total: number; created_at: string }
  counts: { total: number; completed: number; hitl: number; failed: number; running: number }
  jobs: BatchJobSummary[]
}

export const v2Api = {
  // ponytail: fixed high limit, the dashboard filters/pages client-side. Add server-side
  // paging when the queue outgrows ~1000 jobs.
  listJobs: (state?: string) =>
    call<{ jobs: PipelineJob[]; count: number }>(`/jobs?limit=1000${state ? `&state=${state}` : ''}`),

  getJob: (jobId: string) =>
    call<PipelineJob>(`/jobs/${jobId}`),

  submit: async (body: SubmitJobBody): Promise<{ job_id: string }> => {
    const res = await fetch(`${BASE}/jobs`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    })
    if (res.status === 409) {
      const b = await res.json().catch(() => ({})) as { error?: string; message?: string; existing_job_id?: string; product_id?: string }
      throw new DuplicateJobError(
        b.error === 'already_active' ? 'already_active' : 'already_ingested',
        b.message ?? 'Duplicate URL',
        b.existing_job_id ?? null,
        b.product_id ?? null,
      )
    }
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(text || `HTTP ${res.status}`)
    }
    return res.json() as Promise<{ job_id: string }>
  },

  // One request creates and enqueues the whole sheet server-side — the batch keeps running
  // after the tab closes. Progress comes from getBatch, not from this call.
  submitBatch: (body: SubmitBatchBody) =>
    call<SubmitBatchResponse>(`/batches`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getBatch: (batchId: string) =>
    call<BatchStatusResponse>(`/batches/${batchId}`),

  deleteJob: (jobId: string) =>
    call<{ job_id: string; deleted: boolean }>(`/jobs/${jobId}`, { method: 'DELETE' }),

  restart: (jobId: string, from_state: string) =>
    call<{ job_id: string; restarted_from: string; previous_state: string }>(`/jobs/${jobId}/restart`, {
      method: 'POST',
      body: JSON.stringify({ from_state }),
    }),

  proceed: (jobId: string, body: { vton_image_override?: string; segmented_image_override?: string } = {}) =>
    call<{ job_id: string; current_state: string; previous_state: string }>(`/jobs/${jobId}/proceed`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateJobDetails: (jobId: string, body: UpdateJobDetailsBody) =>
    call<{ job_id: string; updated: boolean }>(`/jobs/${jobId}/details`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  savePlacement: (jobId: string, body: SavePlacementBody) =>
    call<{ job_id: string; product_id?: string; placed_image_url: string }>(`/jobs/${jobId}/placement`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Product-keyed placement save (dashboard /admin/placement). Writes placement_* columns onto the
  // catalog rows for this product id, on whichever of products / ingested_products holds it.
  savePlacementForProduct: (productId: string, body: SavePlacementForProductBody) =>
    call<{ product_id: string; key: string; placement: PlacementEntry; placed_image_url: string | null }>(`/products/${productId}/placement`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Legacy 2D placement save (dashboard /admin/placement in 2D mode). Writes only placement_x,
  // placement_y and image_length — the 3D `placement` map is untouched by this route.
  savePlacement2DForProduct: (productId: string, body: SavePlacement2DForProductBody) =>
    call<{ product_id: string; placement_x: number; placement_y: number; image_length: number }>(`/products/${productId}/placement-2d`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  publish: (jobId: string) =>
    call<{ job_id: string; product_id: string; live: boolean }>(`/jobs/${jobId}/publish`, {
      method: 'POST',
      // call() always sends Content-Type: application/json, so a body is required or Fastify
      // rejects it with FST_ERR_CTP_EMPTY_JSON_BODY.
      body: JSON.stringify({}),
    }),

  retagPhoto: (jobId: string, body: RetagPhotoBody) =>
    call<{ job_id: string; slots: SlotMapResult; preferred_slot: SlotKey | null; public_url: string | null; changed: boolean }>(`/jobs/${jobId}/photos/retag`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Soft-deletes one scraped photo (excludes it + recomputes the 4 slots server-side).
  // warning === 'no_usable_image' when the deleted photo was the last VTON-eligible one.
  deletePhoto: (jobId: string, image_url: string) =>
    call<{ job_id: string; slots: SlotMapResult; preferred_slot: SlotKey | null; warning?: string }>(`/jobs/${jobId}/photos/delete`, {
      method: 'POST',
      body: JSON.stringify({ image_url }),
    }),

  // Overwrite the segmented image in place (service-role upload happens server-side —
  // the browser anon key can't write to the storage bucket). imageBase64 is a PNG data URL.
  saveSegmentedImage: (jobId: string, imageBase64: string) =>
    call<{ job_id: string; segmented_image_url: string }>(`/jobs/${jobId}/segmented-image`, {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64 }),
    }),

  // ── Manual asset lane ───────────────────────────────────────────────────────────────────────
  // These CREATE the first copy of an asset, where saveSegmentedImage above overwrites one the
  // pipeline already produced. Each is accepted only while the job sits at its own gate.

  /** The operator's try-on image. PNG or JPEG; no alpha required, it is only ever looked at. */
  uploadManualVton: (jobId: string, imageBase64: string) =>
    call<{ job_id: string; vton_image_url: string }>(`/jobs/${jobId}/manual/vton`, {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64 }),
    }),

  /**
   * The hand-made cut-out. The server rejects a PNG without an alpha channel — a Photoshop export
   * that was flattened looks fine locally but would place as an opaque rectangle.
   */
  uploadManualSegmented: (jobId: string, imageBase64: string) =>
    call<{ job_id: string; segmented_image_url: string }>(`/jobs/${jobId}/manual/segmented`, {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64 }),
    }),
}

export const V2_STORAGE_BUCKET = 'ingestion-automated'
