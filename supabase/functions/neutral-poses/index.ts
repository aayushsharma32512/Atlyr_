// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { requireUser, corsHeaders } from "../_shared/auth.ts"
import { putObject, deleteObjects, copyObject, downloadObject } from "../_shared/storage.ts"
import { IMG_MODEL } from "../_shared/versions.ts"
import { SYSTEM_INSTRUCTION_NEUTRALIZE, PROMPT_NEUTRALIZE } from "../_shared/prompts.ts"
import { generateImage, toInlineImagePartFromBytes } from "../_shared/gemini.ts"

type UploadBody = {
  fullBodyBase64?: string
  fullBodyUrl?: string
  selfieBase64?: string
  selfieUrl?: string
  uploadBatchId?: string
}

type SelectBody = {
  uploadBatchId: string
  candidateIndex: number
  setActive?: boolean
}

type SetActiveBody = { neutralPoseId: string }
type DeleteBody = { neutralPoseId: string }

async function bytesFromBase64(maybeDataUrl: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const commaIdx = maybeDataUrl.indexOf(',')
  let base64 = maybeDataUrl
  let mime = 'application/octet-stream'
  if (maybeDataUrl.startsWith('data:') && commaIdx > -1) {
    const header = maybeDataUrl.slice(0, commaIdx)
    const m = /data:([^;]+);base64/.exec(header)
    if (m && m[1]) mime = m[1]
    base64 = maybeDataUrl.slice(commaIdx + 1)
  }
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return { bytes, mime }
}

async function bytesFromUrl(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch url: ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  const mime = res.headers.get('content-type') || 'application/octet-stream'
  return { bytes: buf, mime }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { correlationId, userId } = await requireUser(req)

  if (!userId) {
    console.warn('[NeutralPoses] No user', { correlationId })
    return new Response(JSON.stringify({ status: 'error', code: 'E_NO_USER', correlationId }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const url = new URL(req.url)
    const pathname = url.pathname

    if (req.method === 'POST' && pathname.endsWith('/upload')) {
      console.log('[NeutralPoses][Upload] start', { correlationId, userId })
      const body: UploadBody = await req.json()
      const uploadBatchId = body.uploadBatchId || crypto.randomUUID()

      // Save sources into temp-candidates bucket (for traceability) and retain bytes for generation
      let fullBodySavedPath = ''
      let selfieSavedPath = ''
      let fullBodyBytes: Uint8Array | null = null
      let fullBodyMime = 'image/png'
      let selfieBytes: Uint8Array | null = null
      let selfieMime = 'image/png'
      if (body.fullBodyBase64 || body.fullBodyUrl) {
        const srcFB = body.fullBodyBase64
          ? await bytesFromBase64(body.fullBodyBase64)
          : await bytesFromUrl(body.fullBodyUrl as string)
        fullBodySavedPath = `${userId}/${uploadBatchId}/source/full-body`
        fullBodyBytes = srcFB.bytes
        fullBodyMime = srcFB.mime
        await putObject('temp-candidates', fullBodySavedPath, srcFB.bytes, srcFB.mime)
      }
      if (body.selfieBase64 || body.selfieUrl) {
        const srcSF = body.selfieBase64
          ? await bytesFromBase64(body.selfieBase64)
          : await bytesFromUrl(body.selfieUrl as string)
        selfieSavedPath = `${userId}/${uploadBatchId}/source/selfie`
        selfieBytes = srcSF.bytes
        selfieMime = srcSF.mime
        await putObject('temp-candidates', selfieSavedPath, srcSF.bytes, srcSF.mime)
      }

      // Generate 4 neutralization candidates via Gemini
      const candidates = [] as { path: string; mime: string }[]
      if (fullBodyBytes) {
        const fullPart = await toInlineImagePartFromBytes(fullBodyBytes, fullBodyMime)
        const selfiePart = selfieBytes && selfieBytes.length > 0 ? await toInlineImagePartFromBytes(selfieBytes, selfieMime) : null
        for (let i = 0; i < 4; i++) {
          try {
            const parts: any[] = [fullPart]
            if (selfiePart) parts.push(selfiePart)
            parts.push({ text: PROMPT_NEUTRALIZE })
            const t0 = Date.now()
            const img = await generateImage({ modelName: IMG_MODEL, systemInstruction: SYSTEM_INSTRUCTION_NEUTRALIZE, parts, temperature: 0.1, seed: 7 + i })
            const dest = `${userId}/${uploadBatchId}/candidate-${i}.png`
            await putObject('temp-candidates', dest, img.bytes, img.mime || 'image/png')
            candidates.push({ path: dest, mime: img.mime || 'image/png' })
            console.log('[NeutralPoses][Upload] candidate ready', { i, elapsedMs: Date.now() - t0, correlationId })
          } catch (e) {
            console.error('[NeutralPoses][Upload] candidate error', { i, err: (e as Error).message, correlationId })
          }
        }
      }

      console.log('[NeutralPoses][Upload] candidates-ready', { correlationId, userId, uploadBatchId, count: candidates.length })
      return new Response(
        JSON.stringify({ status: 'ok', uploadBatchId, candidates, correlationId, sources: { fullBody: fullBodySavedPath, selfie: selfieSavedPath } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (req.method === 'POST' && pathname.endsWith('/select')) {
      const ctx = await requireUser(req)
      const supabase = ctx.adminClient
      console.log('[NeutralPoses][Select] start', { correlationId, userId })
      const body: SelectBody = await req.json()
      const { uploadBatchId, candidateIndex, setActive } = body
      if (!uploadBatchId || candidateIndex == null) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', correlationId }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const poseId = crypto.randomUUID()
      const fromPath = `${userId}/${uploadBatchId}/candidate-${candidateIndex}.png`
      const toPath = `${userId}/${poseId}.png`

      // Copy candidate to final bucket (cross-bucket: download then upload)
      const bytes = await downloadObject('temp-candidates', fromPath)
      await putObject('neutral-poses', toPath, bytes, 'image/png')
      // Insert DB row
      const { error: insertError } = await supabase
        .from('user_neutral_poses')
        .insert({
          id: poseId,
          user_id: userId,
          storage_path: toPath,
          original_fullbody_path: `${userId}/${uploadBatchId}/source/full-body`,
          original_selfie_path: `${userId}/${uploadBatchId}/source/selfie`,
          status: 'ready',
          is_active: false,
        })
      if (insertError) {
        console.error('[NeutralPoses][Select] insert error', { correlationId, err: insertError.message })
        return new Response(JSON.stringify({ status: 'error', code: 'E_DB', message: insertError.message, correlationId }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Optionally set active (best-effort)
      if (setActive) {
        await supabase.from('user_neutral_poses').update({ is_active: false }).eq('user_id', userId)
        await supabase.from('user_neutral_poses').update({ is_active: true }).eq('user_id', userId).eq('storage_path', toPath)
      }

      // Cleanup: delete other candidates and sources
      const deletions: string[] = []
      for (let i = 0; i < 4; i++) {
        if (i !== candidateIndex) deletions.push(`${userId}/${uploadBatchId}/candidate-${i}.png`)
      }
      deletions.push(`${userId}/${uploadBatchId}/source/full-body`)
      deletions.push(`${userId}/${uploadBatchId}/source/selfie`)
      await deleteObjects('temp-candidates', deletions)
      console.log('[NeutralPoses][Cleanup] deleted', { correlationId, count: deletions.length })

      return new Response(
        JSON.stringify({ status: 'ok', neutralPoseId: poseId, storagePath: toPath, isActive: !!setActive, correlationId }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (req.method === 'POST' && pathname.endsWith('/set-active')) {
      const ctx = await requireUser(req)
      const supabase = ctx.adminClient
      console.log('[NeutralPoses][SetActive] start', { correlationId, userId })
      const body: SetActiveBody = await req.json()
      if (!body?.neutralPoseId) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', correlationId }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const { data, error } = await supabase.from('user_neutral_poses').select('id, storage_path').eq('id', body.neutralPoseId).eq('user_id', userId).single()
      if (error || !data) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_NOT_FOUND', correlationId }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      await supabase.from('user_neutral_poses').update({ is_active: false }).eq('user_id', userId)
      await supabase.from('user_neutral_poses').update({ is_active: true }).eq('id', body.neutralPoseId)
      return new Response(JSON.stringify({ status: 'ok', neutralPoseId: body.neutralPoseId, isActive: true, correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const isDeletePoseRequest = (req.method === 'DELETE' && pathname.endsWith('/pose'))
      || (req.method === 'POST' && pathname.endsWith('/delete'))

    if (isDeletePoseRequest) {
      const ctx = await requireUser(req)
      const supabase = ctx.adminClient
      console.log('[NeutralPoses][Delete] start', { correlationId, userId })
      const body: DeleteBody = await req.json()
      if (!body?.neutralPoseId) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_BAD_REQUEST', correlationId }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const { data: pose, error: selErr } = await supabase.from('user_neutral_poses').select('id, storage_path').eq('id', body.neutralPoseId).eq('user_id', userId).single()
      if (selErr || !pose) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_NOT_FOUND', correlationId }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const { data: references, error: refErr } = await supabase
        .from('user_generations')
        .select('id, storage_path')
        .eq('neutral_pose_id', body.neutralPoseId)
      if (refErr) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_DB', message: refErr.message, correlationId }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      if (references && references.length > 0) {
        console.warn('[NeutralPoses][Delete] removing referenced generations', { correlationId, refs: references.length })
        const storageToDelete = references
          .map((ref) => ref.storage_path)
          .filter((p): p is string => typeof p === 'string' && p.length > 0)
        if (storageToDelete.length > 0) {
          try {
            await deleteObjects('generations', storageToDelete)
          } catch (e) {
            console.error('[NeutralPoses][Delete] failed removing generation images', { correlationId, error: (e as Error).message })
          }
        }
        const { error: delRefsErr } = await supabase.from('user_generations').delete().eq('neutral_pose_id', body.neutralPoseId)
        if (delRefsErr) {
          return new Response(JSON.stringify({ status: 'error', code: 'E_DB', message: delRefsErr.message, correlationId }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
      }
      // Proceed to delete row and file
      const { error: delErr } = await supabase.from('user_neutral_poses').delete().eq('id', body.neutralPoseId)
      if (delErr) {
        return new Response(JSON.stringify({ status: 'error', code: 'E_DB', message: delErr.message, correlationId }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      // Best-effort remove file
      const toRemove = [pose.storage_path]
      await deleteObjects('neutral-poses', toRemove)
      return new Response(JSON.stringify({ status: 'ok', deleted: true, correlationId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Not found', correlationId }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('[NeutralPoses] error', { correlationId: (await requireUser(req)).correlationId, error: (error as Error).message })
    return new Response(JSON.stringify({ status: 'error', code: 'E_INTERNAL', message: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
