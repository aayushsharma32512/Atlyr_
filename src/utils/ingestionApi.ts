import { z } from 'zod'

const DEFAULT_BASE_URL = (import.meta.env as { VITE_INGESTION_API_BASE_URL?: string }).VITE_INGESTION_API_BASE_URL ?? 'http://localhost:8787'
const DEFAULT_OPERATOR_TOKEN = (import.meta.env as { VITE_HITL_OPERATOR_TOKEN?: string }).VITE_HITL_OPERATOR_TOKEN ?? 'local-operator-token'

const RecordSchema = z.record(z.string(), z.unknown())

const Phase1PayloadSchema = z.object({
  patch: z
    .object({
      draft: z
        .object({
          product: z.record(z.string(), z.unknown()).optional(),
          images: z.array(z.record(z.string(), z.unknown())).optional(),
        })
        .optional(),
      artifacts: z.record(z.string(), z.unknown()).optional(),
      flags: z.record(z.string(), z.unknown()).optional(),
    })
    .partial()
    .optional(),
  complete: z.boolean().optional(),
  resumeData: RecordSchema.optional(),
})

const Phase2PayloadSchema = z.object({
  patch: z
    .object({
      draft: z
        .object({
          product: z.record(z.string(), z.unknown()).optional(),
          images: z.array(z.record(z.string(), z.unknown())).optional(),
        })
        .optional(),
      artifacts: z.record(z.string(), z.unknown()).optional(),
      flags: z.record(z.string(), z.unknown()).optional(),
      review: z.record(z.string(), z.unknown()).optional(),
    })
    .partial()
    .optional(),
  action: z.enum(['approve', 'regenerate']).optional(),
  node: z.string().optional(),
  data: RecordSchema.optional(),
})

const BatchSubmitPayloadSchema = z.object({
  urls: z.array(z.string()),
  label: z.string().optional(),
})

const BatchSubmitResponseItemSchema = z.discriminatedUnion('status', [
  z.object({
    url: z.string(),
    status: z.literal('invalid'),
    reason: z.string(),
  }),
  z.object({
    url: z.string(),
    status: z.literal('duplicate'),
    jobId: z.string(),
    dedupeKey: z.string(),
    existingStatus: z.string(),
  }),
  z.object({
    url: z.string(),
    status: z.literal('enqueued'),
    jobId: z.string(),
    dedupeKey: z.string(),
  }),
])

const BatchSubmitResponseSchema = z.object({
  batchId: z.string().uuid(),
  summary: z.record(z.string(), z.number()),
  truncated: z.number(),
  items: z.array(BatchSubmitResponseItemSchema),
})

const GhostUploadPayloadSchema = z.object({
  view: z.enum(['front', 'back']),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1)
})

const GhostUploadResponseSchema = z.object({
  storagePath: z.string().min(1)
})

const Phase1ImageUploadPayloadSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  data: z.string().min(1),
})

const Phase1ImageUploadResponseSchema = z.object({
  url: z.string().url(),
  storagePath: z.string().min(1),
  hash: z.string().min(16),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  isPrimary: z.boolean().optional(),
})

const Phase1ImageDeletePayloadSchema = z.object({
  url: z.string().min(1),
})

const Phase1ImageDeleteResponseSchema = z.object({
  deleted: z.boolean(),
})

const CancelJobResponseSchema = z.object({
  jobId: z.string().uuid(),
  cancelled: z.boolean(),
})

const RequeueJobResponseSchema = z.object({
  jobId: z.string().uuid(),
  requeued: z.boolean(),
})

const DeleteJobResponseSchema = z.object({
  deleted: z.boolean(),
})

const CatalogJobSchema = z.object({
  job_id: z.string(),
  original_url: z.string(),
  canonical_url: z.string(),
  domain: z.string(),
  path: z.string(),
  dedupe_key: z.string(),
  batch_id: z.string().nullable(),
  batch_label: z.string().nullable().optional(),
  created_at: z.string(),
  created_by: z.string().nullable().optional(),
  status: z.string(),
  last_step: z.string().nullable(),
  phase_flags: z.record(z.string(), z.unknown()).nullable(),
  queued_at: z.string().nullable(),
  started_at: z.string().nullable(),
  phase1_completed_at: z.string().nullable(),
  phase2_completed_at: z.string().nullable(),
  stage_at: z.string().nullable(),
  promote_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  updated_at: z.string().nullable().optional(),
  error_count: z.number(),
  last_error: z.string().nullable(),
  pause_reason: z.string().nullable(),
  assigned_operator: z.string().nullable().optional(),
})

const JobDetailsResponseSchema = z.object({
  job: CatalogJobSchema.nullish(),
  state: z.record(z.string(), z.unknown()).nullish(),
})

export type PipelineState = Record<string, unknown>
export type Phase1UpdatePayload = z.infer<typeof Phase1PayloadSchema>
export type Phase2UpdatePayload = z.infer<typeof Phase2PayloadSchema>
export type Phase2GhostUploadPayload = z.infer<typeof GhostUploadPayloadSchema>
export type Phase2GhostUploadResponse = z.infer<typeof GhostUploadResponseSchema>
export type Phase1ImageUploadPayload = z.infer<typeof Phase1ImageUploadPayloadSchema>
export type Phase1ImageUploadResponse = z.infer<typeof Phase1ImageUploadResponseSchema>
export type Phase1ImageDeletePayload = z.infer<typeof Phase1ImageDeletePayloadSchema>
export type Phase1ImageDeleteResponse = z.infer<typeof Phase1ImageDeleteResponseSchema>
export type CancelJobResponse = z.infer<typeof CancelJobResponseSchema>
export type RequeueJobResponse = z.infer<typeof RequeueJobResponseSchema>
export type DeleteJobResponse = z.infer<typeof DeleteJobResponseSchema>
export type BatchSubmitPayload = z.infer<typeof BatchSubmitPayloadSchema>
export type BatchSubmitResponse = z.infer<typeof BatchSubmitResponseSchema>
export type CatalogJob = z.infer<typeof CatalogJobSchema>
export type JobDetailsResponse = z.infer<typeof JobDetailsResponseSchema>

export type JobStatusResponse = {
  jobId: string
  status: string
  step?: string | null
  pause?: Record<string, unknown> | null
  flags?: Record<string, unknown> | null
}

interface RequestOptions {
  token?: string
  signal?: AbortSignal
}

function apiBaseUrl() {
  return DEFAULT_BASE_URL.replace(/\/$/, '')
}

function resolveToken(token?: string) {
  return token ?? DEFAULT_OPERATOR_TOKEN
}

async function request<T>(path: string, init: RequestInit, options?: RequestOptions): Promise<T> {
  const base = apiBaseUrl()
  const headers = new Headers(init.headers)
  const body = init.body
  if (body && !(headers.has('Content-Type') || headers.has('content-type'))) {
    headers.set('Content-Type', 'application/json')
  }
  const token = resolveToken(options?.token)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    signal: options?.signal,
  })

  if (!response.ok) {
    const message = await safeReadError(response)
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  if (!text) {
    return undefined as T
  }

  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new Error('Unable to parse response JSON')
  }
}

async function safeReadError(response: Response): Promise<string | null> {
  try {
    const text = await response.text()
    if (!text) return null
    try {
      const json = JSON.parse(text)
      if (json?.error) return typeof json.error === 'string' ? json.error : JSON.stringify(json.error)
      return text
    } catch {
      return text
    }
  } catch {
    return null
  }
}

export async function fetchJob(jobId: string, options?: RequestOptions): Promise<PipelineState> {
  return request(`/jobs/${jobId}`, { method: 'GET' }, options)
}

export async function fetchJobStatus(jobId: string, options?: RequestOptions): Promise<JobStatusResponse> {
  return request(`/job-status/${jobId}`, { method: 'GET' }, options)
}

export async function updatePhase1(jobId: string, payload: Phase1UpdatePayload, options?: RequestOptions) {
  const parsed = Phase1PayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid Phase 1 payload')
  }
  return request(`/jobs/${jobId}/phase1`, {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  }, options)
}

export async function updatePhase2(jobId: string, payload: Phase2UpdatePayload, options?: RequestOptions) {
  const parsed = Phase2PayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid Phase 2 payload')
  }
  return request(`/jobs/${jobId}/phase2`, {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  }, options)
}

export async function uploadPhase2Ghost(jobId: string, payload: Phase2GhostUploadPayload, options?: RequestOptions): Promise<Phase2GhostUploadResponse> {
  const parsed = GhostUploadPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid ghost upload payload')
  }
  const response = await request(`/jobs/${jobId}/phase2/uploads`, {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  }, options)
  const validated = GhostUploadResponseSchema.safeParse(response)
  if (!validated.success) {
    throw new Error('Invalid upload response from server')
  }
  return validated.data
}

export async function uploadPhase1Image(jobId: string, payload: Phase1ImageUploadPayload, options?: RequestOptions): Promise<Phase1ImageUploadResponse> {
  const parsed = Phase1ImageUploadPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid Phase 1 upload payload')
  }
  const response = await request(`/jobs/${jobId}/phase1/uploads`, {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  }, options)
  const validated = Phase1ImageUploadResponseSchema.safeParse(response)
  if (!validated.success) {
    throw new Error('Invalid Phase 1 upload response from server')
  }
  return validated.data
}

export async function deletePhase1Image(jobId: string, payload: Phase1ImageDeletePayload, options?: RequestOptions): Promise<Phase1ImageDeleteResponse> {
  const parsed = Phase1ImageDeletePayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid Phase 1 delete payload')
  }
  const response = await request(`/jobs/${jobId}/phase1/images/delete`, {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  }, options)
  const validated = Phase1ImageDeleteResponseSchema.safeParse(response)
  if (!validated.success) {
    throw new Error('Invalid Phase 1 delete response from server')
  }
  return validated.data
}

export async function cancelIngestionJob(jobId: string, options?: RequestOptions): Promise<CancelJobResponse> {
  const response = await request(`/jobs/${jobId}/cancel`, { method: 'POST' }, options)
  const validated = CancelJobResponseSchema.safeParse(response)
  if (!validated.success) {
    throw new Error('Invalid cancel response from server')
  }
  return validated.data
}

export async function requeueIngestionJob(jobId: string, options?: RequestOptions): Promise<RequeueJobResponse> {
  const response = await request(`/jobs/${jobId}/requeue`, { method: 'POST' }, options)
  const validated = RequeueJobResponseSchema.safeParse(response)
  if (!validated.success) {
    throw new Error('Invalid requeue response from server')
  }
  return validated.data
}

export async function deleteIngestionJob(jobId: string, options?: RequestOptions): Promise<DeleteJobResponse> {
  const response = await request(`/jobs/${jobId}`, { method: 'DELETE' }, options)
  const validated = DeleteJobResponseSchema.safeParse(response)
  if (!validated.success) {
    throw new Error('Invalid delete response from server')
  }
  return validated.data
}

export async function submitJobsBatch(payload: BatchSubmitPayload, options?: RequestOptions): Promise<BatchSubmitResponse> {
  const parsed = BatchSubmitPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid batch submit payload')
  }
  const response = await request('/jobs/batch-submit', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  }, options)
  const validated = BatchSubmitResponseSchema.safeParse(response)
  if (!validated.success) {
    throw new Error('Invalid batch submit response')
  }
  return validated.data
}

export function getOperatorToken(): string {
  return resolveToken()
}

export function getIngestionApiBaseUrl(): string {
  return apiBaseUrl()
}

export async function fetchJobDetails(jobId: string, options?: RequestOptions): Promise<JobDetailsResponse> {
  const response = await request(`/jobs/${jobId}/details`, { method: 'GET' }, options)
  const parsed = JobDetailsResponseSchema.safeParse(response)
  if (!parsed.success) {
    throw new Error('Invalid job details response')
  }
  return parsed.data
}
