export type VisualSearchCategory = "upper" | "lower" | "shoes"

export type VisualSearchArtifact = {
  key: string
  title: string
  description: string
  filename: string
  dataUrl: string
}

export type GroundingDinoDetection = {
  box: [number, number, number, number]
  label: string
  score: number
  overlapPixels: number
  maskCoverage: number
  boxPrecision: number
  areaRatioToFashnBox: number | null
  eligible: boolean
  selected: boolean
}

export type VisualSearchTestResult = {
  requestId: string
  category: VisualSearchCategory
  imageSize: { width: number; height: number }
  targetClasses: Array<{ id: number; label: string }>
  classPixelCounts: Record<string, number>
  fashn: {
    targetPixels: number
    minimumTargetPixels: number
    usable: boolean
    targetCoverage: number
    foregroundPixels: number
    foregroundCoverage: number
    box: [number, number, number, number] | null
  }
  groundingDino: {
    queries: string[]
    detections: GroundingDinoDetection[]
    selectedIndex: number | null
  }
  finalBox: [number, number, number, number]
  boxSource: "fashn_union_dino" | "fashn_only" | "dino_only"
  artifacts: VisualSearchArtifact[]
  timingsMs: {
    fashn: number
    groundingDino: number
    total: number
  }
  constraints: {
    usesSam2: false
    generatesEmbeddings: false
    writesDatabase: false
    persistsArtifacts: false
  }
}

export type RunVisualSearchTestInput = {
  endpoint: string
  token: string
  file: File
  category: VisualSearchCategory
}

export async function runVisualSearchTest({
  endpoint,
  token,
  file,
  category,
}: RunVisualSearchTestInput): Promise<VisualSearchTestResult> {
  const normalizedEndpoint = endpoint.trim().replace(/\/$/, "")
  if (!normalizedEndpoint) throw new Error("Enter the Modal test endpoint")
  if (!token.trim()) throw new Error("Enter the visual-search test token")

  const form = new FormData()
  form.set("image", file)
  form.set("category", category)

  const response = await fetch(`${normalizedEndpoint}/analyze`, {
    method: "POST",
    headers: { "X-Visual-Search-Token": token.trim() },
    body: form,
  })
  const payload = await response.json().catch(() => ({})) as VisualSearchTestResult & {
    detail?: string
    error?: string
  }
  if (!response.ok) {
    throw new Error(payload.detail ?? payload.error ?? `Visual-search analysis failed (${response.status})`)
  }
  return payload
}
