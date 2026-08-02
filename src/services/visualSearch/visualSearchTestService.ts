export type VisualSearchCategory = "upper" | "lower" | "shoes"

export type VisualSearchCandidate = {
  id: string
  product_name: string | null
  brand: string | null
  price: number | null
  currency: string | null
  image_url: string | null
  thumbnail_url: string | null
  product_url: string | null
  type: "top" | "bottom" | "shoes"
  type_category: string | null
  color: string | null
  similarity: number
  fused_score?: number
  original_crop_similarity?: number | null
  segmented_cutout_similarity?: number | null
  original_crop_rank?: number | null
  segmented_cutout_rank?: number | null
}

export type VisualSearchTestResult = {
  requestId: string
  category: VisualSearchCategory
  detector: "fashn_parse_sam2" | "gdino_sam2"
  searchBox: [number, number, number, number]
  cutoutDataUrl: string
  queryImages: {
    originalCropDataUrl: string
    segmentedCutoutDataUrl: string
  }
  candidates: VisualSearchCandidate[]
  candidateSets: {
    originalCrop: VisualSearchCandidate[]
    segmentedCutout: VisualSearchCandidate[]
  }
  timingsMs: {
    segmentation: number
    queryPreparation: number
    embedding: number
    catalogSearch: number
    total: number
  }
}

export type RunVisualSearchTestInput = {
  endpoint: string
  token: string
  file: File
  category: VisualSearchCategory
  threshold?: number
  count?: number
}

export async function runVisualSearchTest({
  endpoint,
  token,
  file,
  category,
  threshold = 0.75,
  count = 12,
}: RunVisualSearchTestInput): Promise<VisualSearchTestResult> {
  const normalizedEndpoint = endpoint.trim().replace(/\/$/, "")
  if (!normalizedEndpoint) throw new Error("Enter the Modal test endpoint")
  if (!token.trim()) throw new Error("Enter the visual-search test token")

  const form = new FormData()
  form.set("image", file)
  form.set("category", category)
  form.set("threshold", String(threshold))
  form.set("count", String(count))

  const response = await fetch(`${normalizedEndpoint}/search`, {
    method: "POST",
    headers: { "X-Visual-Search-Token": token.trim() },
    body: form,
  })
  const payload = await response.json().catch(() => ({})) as VisualSearchTestResult & {
    detail?: string
    error?: string
  }
  if (!response.ok) {
    throw new Error(payload.detail ?? payload.error ?? `Visual search failed (${response.status})`)
  }
  return payload
}
