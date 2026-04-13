import { SUPABASE_URL_FOR_FUNCTIONS, supabase } from '@/integrations/supabase/client'
import { getOrSignInAnon } from '@/utils/auth'

export type NeutralUploadReq = {
  fullBodyBase64?: string
  fullBodyUrl?: string
  selfieBase64?: string
  selfieUrl?: string
  uploadBatchId?: string
}

export type NeutralUploadRes = {
  status: 'ok'
  uploadBatchId: string
  candidates: { path: string; mime: string }[]
  sources: { fullBody?: string; selfie?: string }
  correlationId: string
}

export type NeutralSelectReq = { uploadBatchId: string; candidateIndex: number; setActive?: boolean }
export type NeutralSelectRes = { status: 'ok'; neutralPoseId: string; storagePath: string; isActive: boolean; correlationId: string }

export type SetActiveReq = { neutralPoseId: string }
export type DeletePoseReq = { neutralPoseId: string }

export type SummariesPrecheckReq = { products: { id: string; type: 'top' | 'bottom'; gender?: 'male' | 'female' | 'unisex' }[]; requiredVersion?: string }
export type SummariesPrecheckRes =
  | { status: 'ok'; needsCompute: boolean; assets: Record<string, { model: string | null; flatlay: string | null }>; correlationId: string }
  | { status: 'missing_assets'; details: Array<{ productId: string; missing: string[] }>; correlationId: string }

export type SummariesComputeReq = {
  top?: { productId: string; modelUrl?: string; flatlayUrl?: string }
  bottom?: { productId: string; modelUrl?: string; flatlayUrl?: string }
  version?: string
  temps?: { desc_temp?: number; seed?: number }
}
export type SummariesComputeRes = { status: 'ok'; updated: Array<{ productId: string; version: string }>; durationMs: number; correlationId: string }

export type VtoPrecheckReq = { topId: string; bottomId?: string | null; neutralPoseId: string; requireSummariesVersion?: string }
export type VtoPrecheckRes =
  | { status: 'ok'; inputs: { neutralPosePath: string; topModelUrl: string; bottomModelUrl: string | null }; correlationId: string }
  | { status: 'missing_assets'; details: string[]; correlationId: string }
  | { status: 'summaries_outdated'; correlationId: string }

export type VtoGenerateReq = { outfitSnapshot?: any; topId: string; bottomId?: string | null; neutralPoseId: string }
export type VtoGenerateRes = { status: 'ready'; generationId: string; outfitId: string; storagePath: string; signedUrl?: string; durationMs: number; correlationId: string }

function withCorrelationId(init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('x-correlation-id', crypto.randomUUID())
  return { ...init, headers }
}

async function authHeaders() {
  await getOrSignInAnon()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
  return headers
}

function fnUrl(name: string, path: string) {
  return `${SUPABASE_URL_FOR_FUNCTIONS}/functions/v1/${name}${path}`
}

export const vtoApi = {
  async neutralUpload(body: NeutralUploadReq): Promise<NeutralUploadRes> {
    const headers = await authHeaders()
    const res = await fetch(fnUrl('neutral-poses', '/upload'), withCorrelationId({ method: 'POST', headers, body: JSON.stringify(body) }))
    if (!res.ok) throw new Error(`neutral-upload failed: ${res.status}`)
    return res.json()
  },
  async neutralSelect(body: NeutralSelectReq): Promise<NeutralSelectRes> {
    const headers = await authHeaders()
    const res = await fetch(fnUrl('neutral-poses', '/select'), withCorrelationId({ method: 'POST', headers, body: JSON.stringify(body) }))
    if (!res.ok) throw new Error(`neutral-select failed: ${res.status}`)
    return res.json()
  },
  async neutralSetActive(body: SetActiveReq) {
    const headers = await authHeaders()
    const res = await fetch(fnUrl('neutral-poses', '/set-active'), withCorrelationId({ method: 'POST', headers, body: JSON.stringify(body) }))
    if (!res.ok) throw new Error(`set-active failed: ${res.status}`)
    return res.json()
  },
  async neutralDelete(body: DeletePoseReq) {
    const headers = await authHeaders()
    const res = await fetch(fnUrl('neutral-poses', '/delete'), withCorrelationId({ method: 'POST', headers, body: JSON.stringify(body) }))
    if (!res.ok) throw new Error(`delete-pose failed: ${res.status}`)
    return res.json()
  },
  async summariesPrecheck(body: SummariesPrecheckReq): Promise<SummariesPrecheckRes> {
    const headers = await authHeaders()
    const res = await fetch(fnUrl('summaries', '/precheck'), withCorrelationId({ method: 'POST', headers, body: JSON.stringify(body) }))
    if (!res.ok) throw new Error(`summaries-precheck failed: ${res.status}`)
    return res.json()
  },
  async summariesCompute(body: SummariesComputeReq): Promise<SummariesComputeRes> {
    const headers = await authHeaders()
    console.debug('[vtoApi] summariesCompute request', body)
    const res = await fetch(fnUrl('summaries', '/compute'), withCorrelationId({ method: 'POST', headers, body: JSON.stringify(body) }))
    const json = await res.json()
    console.debug('[vtoApi] summariesCompute response', { status: res.status, json })
    if (!res.ok) throw new Error(`summaries-compute failed: ${res.status}`)
    return json
  },
  async vtoPrecheck(body: VtoPrecheckReq): Promise<VtoPrecheckRes> {
    const headers = await authHeaders()
    const res = await fetch(fnUrl('vto', '/precheck'), withCorrelationId({ method: 'POST', headers, body: JSON.stringify(body) }))
    if (!res.ok) throw new Error(`vto-precheck failed: ${res.status}`)
    return res.json()
  },
  async vtoGenerate(body: VtoGenerateReq): Promise<VtoGenerateRes> {
    const headers = await authHeaders()
    const res = await fetch(fnUrl('vto', '/generate'), withCorrelationId({ method: 'POST', headers, body: JSON.stringify(body) }))
    if (!res.ok) throw new Error(`vto-generate failed: ${res.status}`)
    return res.json()
  },
}

