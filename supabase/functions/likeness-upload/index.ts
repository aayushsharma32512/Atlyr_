// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

import { corsHeaders, requireUser } from "../_shared/auth.ts"
import { fetchUserProfile } from "../_shared/profiles.ts"
import {
  LIKENESS_STAGE1_MODEL,
  LIKENESS_STAGE2_MODEL,
  LIKENESS_STAGE2_ASPECT_RATIO,
  LIKENESS_STAGE2_IMAGE_SIZE,
} from "../_shared/versions.ts"
import {
  SYSTEM_INSTRUCTION_LIKENESS_STAGE1,
  PROMPT_LIKENESS_STAGE1,
  SYSTEM_INSTRUCTION_NEUTRALIZE,
  PROMPT_NEUTRALIZE,
} from "../_shared/prompts.ts"
import { getGeminiClient, toInlineImagePartFromBytes } from "../_shared/gemini.ts"
import { putObject, createSignedUrl } from "../_shared/storage.ts"

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"])
const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024 // 30MB safety cap
const TEMP_BUCKET = "temp-candidates"
const SELFIE_KEY = "selfie"
const FULLBODY_KEY = "fullBody"
const MAX_CANDIDATES = 8
const DEFAULT_PARALLEL_STREAMS = 2

type FormImage = {
  bytes: Uint8Array
  mimeType: string
  filename: string
}

type UploadRequest = {
  selfie: FormImage
  fullBody: FormImage
  overrides: {
    height?: string | null
    weight?: string | null
    skinTone?: string | null
  }
  candidateCount: number
  parallelStreams: number
  uploadBatchId?: string | null
}

function safeFilename(filename: string, fallback: string) {
  if (!filename) return fallback
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_") || fallback
}

function extensionFromMime(mime: string) {
  switch (mime) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/heic":
    case "image/heif":
      return "heic"
    default:
      return "img"
  }
}

async function readFormImage(file: File | null, fieldName: string): Promise<FormImage> {
  if (!file) {
    throw new Error(fieldName === SELFIE_KEY ? "MISSING_SELFIE" : "MISSING_FULLBODY")
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0) throw new Error("EMPTY_FILE")
  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    throw new Error("FILE_TOO_LARGE")
  }
  const mimeType = file.type || "application/octet-stream"
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("UNSUPPORTED_MIME")
  }
  return { bytes, mimeType, filename: file.name }
}

async function parseUploadRequest(req: Request): Promise<UploadRequest> {
  const contentType = req.headers.get("content-type") || ""
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new Error("UNSUPPORTED_CONTENT_TYPE")
  }
  const formData = await req.formData()
  const selfie = await readFormImage(formData.get(SELFIE_KEY) as File | null, SELFIE_KEY)
  const fullBody = await readFormImage(formData.get(FULLBODY_KEY) as File | null, FULLBODY_KEY)
  const overrides = {
    height: (formData.get("height") as string | null) ?? null,
    weight: (formData.get("weight") as string | null) ?? null,
    skinTone: (formData.get("skinTone") as string | null) ?? null,
  }
  const candidateRaw = (formData.get("candidateCount") as string | null) ?? undefined
  const candidateCount = Number.isNaN(Number(candidateRaw)) ? 4 : Math.max(1, Math.min(MAX_CANDIDATES, Number(candidateRaw)))
  const parallelRaw = (formData.get("parallelStreams") as string | null) ?? undefined
  const resolvedParallel =
    Number.isNaN(Number(parallelRaw)) || parallelRaw === null
      ? DEFAULT_PARALLEL_STREAMS
      : Math.max(1, Math.min(candidateCount, Number(parallelRaw)))
  const uploadBatchId = (formData.get("uploadBatchId") as string | null) ?? null
  return { selfie, fullBody, overrides, candidateCount, parallelStreams: resolvedParallel, uploadBatchId }
}

function buildMetadata(profile: any, overrides: UploadRequest["overrides"]) {
  const height =
    overrides.height ??
    (profile?.height_cm ? `${profile.height_cm} cm` : null)
  const weight =
    overrides.weight ??
    (profile?.weight_kg ? `${profile.weight_kg} kg` : null)
  const skinTone = overrides.skinTone ?? profile?.skin_tone ?? null
  return { height, weight, skinTone }
}

function buildIdentityPrompt(metadata: ReturnType<typeof buildMetadata>) {
  return PROMPT_LIKENESS_STAGE1.replace("{USER_HEIGHT}", metadata.height ?? "unknown")
    .replace("{USER_WEIGHT}", metadata.weight ?? "unknown")
    .replace("{USER_SKIN_TONE}", metadata.skinTone ?? "unknown")
}

function extractIdentitySummary(raw: string) {
  if (!raw) return ""
  const match = raw.match(/<identity_summary>([\s\S]*?)<\/identity_summary>/i)
  if (match?.[1]) {
    return match[1].trim()
  }
  return raw.trim()
}

function base64ToBytes(data: string) {
  const binary = atob(data)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function storeImage({
  userId,
  batchId,
  type,
  formImage,
}: {
  userId: string
  batchId: string
  type: typeof SELFIE_KEY | typeof FULLBODY_KEY | "candidate"
  formImage: FormImage
}) {
  const ext = extensionFromMime(formImage.mimeType)
  const filename =
    type === "candidate"
      ? formImage.filename
      : safeFilename(formImage.filename, `${type}.${ext}`)
  const path = `${userId}/${batchId}/${type === "candidate" ? `candidates/${filename}` : `sources/${type}.${ext}`}`
  await putObject(TEMP_BUCKET, path, formImage.bytes, formImage.mimeType)
  return path
}

type GeneratedCandidate = {
  index: number
  summary: string
  bytes: Uint8Array
  mimeType: string
}

async function generateIdentitySummary({
  model,
  selfiePart,
  fullBodyPart,
  prompt,
  seed,
}: {
  model: any
  selfiePart: any
  fullBodyPart: any
  prompt: string
  seed: number
}) {
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [selfiePart, fullBodyPart, { text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topK: 1,
      seed,
    },
  })
  const summary = extractIdentitySummary(result.response?.text?.() ?? "")
  if (!summary) throw new Error("IDENTITY_SUMMARY_EMPTY")
  return summary
}

async function generateCandidateImage({
  model,
  selfiePart,
  fullBodyPart,
  identitySummary,
  seed,
}: {
  model: any
  selfiePart: any
  fullBodyPart: any
  identitySummary: string
  seed: number
}) {
  const prompt = `${PROMPT_NEUTRALIZE}\n\n<identity_summary>\n${identitySummary}\n</identity_summary>`
  const response = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [selfiePart, fullBodyPart, { text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topK: 1,
      responseModalities: ["IMAGE"],
      seed,
      imageConfig: {
        aspectRatio: LIKENESS_STAGE2_ASPECT_RATIO,
        imageSize: LIKENESS_STAGE2_IMAGE_SIZE,
      },
    },
  })
  const responseCandidates = response.response?.candidates ?? []
  const inlineCandidate = responseCandidates
    .flatMap((cand: any) => cand?.content?.parts || [])
    .find((part: any) => part?.inlineData?.data)
  if (!inlineCandidate) {
    throw new Error("STAGE2_NO_IMAGE")
  }
  const mimeType = inlineCandidate.inlineData.mimeType || "image/png"
  const bytes = base64ToBytes(inlineCandidate.inlineData.data)
  return { bytes, mimeType }
}

async function executePipeline({
  index,
  stage1Model,
  stage2Model,
  selfiePart,
  fullBodyPart,
  prompt,
  seedBase,
}: {
  index: number
  stage1Model: any
  stage2Model: any
  selfiePart: any
  fullBodyPart: any
  prompt: string
  seedBase: number
}): Promise<GeneratedCandidate> {
  const summary = await generateIdentitySummary({
    model: stage1Model,
    selfiePart,
    fullBodyPart,
    prompt,
    seed: seedBase + index,
  })
  const image = await generateCandidateImage({
    model: stage2Model,
    selfiePart,
    fullBodyPart,
    identitySummary: summary,
    seed: seedBase + index * 2,
  })
  return { index, summary, bytes: image.bytes, mimeType: image.mimeType }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "error", code: "E_METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const auth = await requireUser(req)
  if (!auth.userId) {
    return new Response(JSON.stringify({ status: "error", code: "E_UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Atomic limit check + slot reservation using Postgres function
  // This prevents race conditions - the check and insert are one atomic operation
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const adminSupabase = createClient(supabaseUrl, supabaseKey)

  const reservedCandidateId = crypto.randomUUID()
  const reservedBatchId = crypto.randomUUID()

  const { data: reserveResult, error: reserveError } = await adminSupabase.rpc('reserve_likeness_slot', {
    p_candidate_id: reservedCandidateId,
    p_user_id: auth.userId,
    p_batch_id: reservedBatchId,
    p_daily_limit: 3,
  })

  if (reserveError) {
    console.error("[LikenessUpload] reserve_likeness_slot error", { correlationId: auth.correlationId, message: reserveError.message })
    return new Response(
      JSON.stringify({ status: "error", code: "E_SLOT_RESERVE_FAILED", correlationId: auth.correlationId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // If reserveResult is null, the limit was reached (atomic check failed)
  if (!reserveResult) {
    console.warn("[LikenessUpload] limit reached (atomic)", { correlationId: auth.correlationId, userId: auth.userId })
    return new Response(
      JSON.stringify({
        status: "error",
        code: "E_LIMIT_REACHED",
        message: "You have reached the daily limit of 3 likeness generations.",
        correlationId: auth.correlationId,
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  try {
    console.log("[LikenessUpload] start", { userId: auth.userId, correlationId: auth.correlationId })
    const uploadRequest = await parseUploadRequest(req)
    // Use the reserved batchId, not a new one
    const batchId = uploadRequest.uploadBatchId || reservedBatchId
    const profile = await fetchUserProfile(auth)
    const metadata = buildMetadata(profile, uploadRequest.overrides)
    const prompt = buildIdentityPrompt(metadata)
    const selfieInlinePart = await toInlineImagePartFromBytes(uploadRequest.selfie.bytes, uploadRequest.selfie.mimeType)
    const fullBodyInlinePart = await toInlineImagePartFromBytes(uploadRequest.fullBody.bytes, uploadRequest.fullBody.mimeType)
    const genai = getGeminiClient()
    const stage1Model = genai.getGenerativeModel({
      model: LIKENESS_STAGE1_MODEL,
      systemInstruction: SYSTEM_INSTRUCTION_LIKENESS_STAGE1,
    })
    const stage2Model = genai.getGenerativeModel({
      model: LIKENESS_STAGE2_MODEL,
      systemInstruction: SYSTEM_INSTRUCTION_NEUTRALIZE,
    })

    const [selfiePath, fullBodyPath] = await Promise.all([
      storeImage({
        userId: auth.userId!,
        batchId,
        type: SELFIE_KEY,
        formImage: uploadRequest.selfie,
      }),
      storeImage({
        userId: auth.userId!,
        batchId,
        type: FULLBODY_KEY,
        formImage: uploadRequest.fullBody,
      }),
    ])

    const pipelineIndexes = Array.from({ length: uploadRequest.candidateCount }, (_, idx) => idx)
    const parallelStreams = Math.max(1, Math.min(uploadRequest.parallelStreams, uploadRequest.candidateCount))
    const seedBase = Date.now() % 1_000_000
    const generatedCandidates: GeneratedCandidate[] = []

    for (let i = 0; i < pipelineIndexes.length; i += parallelStreams) {
      const batch = pipelineIndexes.slice(i, i + parallelStreams)
      const settled = await Promise.allSettled(
        batch.map((index) =>
          executePipeline({
            index,
            stage1Model,
            stage2Model,
            selfiePart: selfieInlinePart,
            fullBodyPart: fullBodyInlinePart,
            prompt,
            seedBase,
          }),
        ),
      )
      settled.forEach((result, idx) => {
        const index = batch[idx]
        if (result.status === "fulfilled") {
          generatedCandidates.push(result.value)
        } else {
          console.error("[LikenessUpload] pipeline failed", {
            index,
            error: (result.reason as Error)?.message ?? "unknown",
        correlationId: auth.correlationId,
          })
        }
      })
    }

    if (generatedCandidates.length === 0) {
      throw new Error("NO_CANDIDATES")
    }

    generatedCandidates.sort((a, b) => a.index - b.index)

    // Initialize Supabase client for database persistence
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const candidatePayloads: { index: number; path: string; mimeType: string; signedUrl: string | null; summary: string }[] = []
    const summariesDescriptor: Array<{ index: number; summary: string }> = []
    const candidateInserts: Array<{ 
      user_id: string
      batch_id: string
      candidate_index: number
      storage_path: string
      mime_type: string
      identity_summary: string
    }> = []

    // Store candidates to storage and prepare DB inserts
    for (const candidate of generatedCandidates) {
      const candidatePath = `${auth.userId}/${batchId}/candidates/${String(candidate.index + 1).padStart(2, "0")}.png`
      await putObject(TEMP_BUCKET, candidatePath, candidate.bytes, candidate.mimeType)
      const signed = await createSignedUrl(TEMP_BUCKET, candidatePath, 300).catch(() => null)
      
      candidatePayloads.push({
        index: candidate.index,
        path: candidatePath,
        mimeType: candidate.mimeType,
        signedUrl: signed?.signedUrl ?? null,
        summary: candidate.summary,
      })
      summariesDescriptor.push({ index: candidate.index, summary: candidate.summary })
      
      // Prepare database insert
      candidateInserts.push({
        user_id: auth.userId!,
        batch_id: batchId,
        candidate_index: candidate.index,
        storage_path: candidatePath,
        mime_type: candidate.mimeType,
        identity_summary: candidate.summary,
      })
    }

    // Persist candidates to database
    // First delete the placeholder record (by id), then insert real candidates
    await supabase
      .from("likeness_candidates")
      .delete()
      .eq("id", reservedCandidateId)

    const { error: dbError } = await supabase
      .from("likeness_candidates")
      .insert(candidateInserts)

    if (dbError) {
      console.error("[LikenessUpload] DB insert failed", {
        error: dbError.message,
        batchId,
        correlationId: auth.correlationId,
      })
      // Don't fail the request - candidates are still in storage
    }

    const sourcesDescriptor = [
      { type: "selfie", path: selfiePath, mimeType: uploadRequest.selfie.mimeType },
      { type: "fullBody", path: fullBodyPath, mimeType: uploadRequest.fullBody.mimeType },
    ]

    const metadataPath = `${auth.userId}/${batchId}/metadata.json`
    await putObject(
      TEMP_BUCKET,
      metadataPath,
      new TextEncoder().encode(
        JSON.stringify({
          identitySummary: summariesDescriptor[0]?.summary ?? null,
          summaries: summariesDescriptor,
          metadata,
          sources: sourcesDescriptor,
          candidateCount: candidatePayloads.length,
        }),
      ),
      "text/plain",
    )

    const responseBody = {
      status: "ok",
      uploadBatchId: batchId,
      identitySummary: summariesDescriptor[0]?.summary ?? null,
      summaries: summariesDescriptor,
      metadata,
      sources: sourcesDescriptor,
      candidates: candidatePayloads,
      candidateCount: candidatePayloads.length,
      parallelStreams,
      correlationId: auth.correlationId,
    }

    console.log("[LikenessUpload] completed", {
      userId: auth.userId,
      batchId,
      candidateCount: candidatePayloads.length,
      correlationId: auth.correlationId,
    })

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("[LikenessUpload] error", { error: (error as Error).message })
    
    // Clean up the reserved placeholder on error (using the id we generated for the atomic reserve)
    try {
      await adminSupabase
        .from("likeness_candidates")
        .delete()
        .eq("id", reservedCandidateId)
    } catch (cleanupErr) {
      console.error("[LikenessUpload] failed to cleanup placeholder", { error: (cleanupErr as Error).message })
    }
    
    return new Response(JSON.stringify({ status: "error", code: (error as Error).message ?? "E_UPLOAD_FAILED" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})


