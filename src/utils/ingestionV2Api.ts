const BASE = (import.meta.env as Record<string, string>).VITE_INGESTION_V2_API_URL ?? 'http://localhost:3001'
const TOKEN = (import.meta.env as Record<string, string>).VITE_INGESTION_V2_API_TOKEN ?? 'dev-token-change-me'

async function call<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as T
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
  v_ton_preferred_image: string | null
  vton_image_url: string | null
  segmented_image_url: string | null
  ingested_product_id: string | null
  error_count: number
  last_error: string | null
  last_error_step: string | null
  created_by: string | null
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

export interface SubmitJobBody {
  product_url: string
  product_gender_type: 'male' | 'female' | 'unisex'
  product_type: 'topwear' | 'bottomwear' | 'dress'
  product_sub_type: string
  product_complexity: string
  v_ton_model?: string
  hitl_post_identification?: boolean
  hitl_post_segmentation?: boolean
}

export const v2Api = {
  listJobs: (state?: string) =>
    call<{ jobs: PipelineJob[]; count: number }>(`/jobs${state ? `?state=${state}` : ''}`),

  getJob: (jobId: string) =>
    call<PipelineJob>(`/jobs/${jobId}`),

  submit: (body: SubmitJobBody) =>
    call<{ job_id: string }>('/jobs', { method: 'POST', body: JSON.stringify(body) }),

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

  retagPhoto: (jobId: string, body: RetagPhotoBody) =>
    call<{ job_id: string; slots: SlotMapResult; preferred_slot: SlotKey | null; public_url: string | null; changed: boolean }>(`/jobs/${jobId}/photos/retag`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export const V2_STORAGE_BUCKET = 'ingestion-automated'
