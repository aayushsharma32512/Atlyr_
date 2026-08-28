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

export type VisualSearchOnlineProduct = {
  position: number
  title: string
  link: string
  source: string | null
  image: string
  thumbnail: string | null
  displayPrice: string | null
  price: number | null
  currency: string | null
  inStock: boolean | null
  rating: number | null
  reviews: number | null
  condition: string | null
  exactMatch: boolean
}

export type VisualSearchOnlineResult = {
  provider: "serpapi_google_lens"
  queryArtifactKey: "fashnForegroundCrop"
  category: VisualSearchCategory
  country: string
  query: string
  products: VisualSearchOnlineProduct[]
  rawMatchCount: number
  searchId: string | null
  timingsMs: {
    imageUpload: number
    lens: number
    total: number
  }
  constraints: {
    writesDatabase: false
    persistsResults: false
    generatesEmbeddings: false
  }
}

export type RunVisualSearchOnlineInput = {
  endpoint: string
  token: string
  artifact: VisualSearchArtifact
  category: VisualSearchCategory
  country?: string
}

function getEndpointAndToken(endpoint: string, token: string) {
  const normalizedEndpoint = endpoint.trim().replace(/\/$/, "")
  if (!normalizedEndpoint) throw new Error("Enter the Modal test endpoint")
  if (!token.trim()) throw new Error("Enter the visual-search test token")
  return { normalizedEndpoint, normalizedToken: token.trim() }
}

export async function runVisualSearchTest({
  endpoint,
  token,
  file,
  category,
}: RunVisualSearchTestInput): Promise<VisualSearchTestResult> {
  const { normalizedEndpoint, normalizedToken } = getEndpointAndToken(endpoint, token)

  const form = new FormData()
  form.set("image", file)
  form.set("category", category)

  const response = await fetch(`${normalizedEndpoint}/analyze`, {
    method: "POST",
    headers: { "X-Visual-Search-Token": normalizedToken },
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

export async function runVisualSearchOnline({
  endpoint,
  token,
  artifact,
  category,
  country = "in",
}: RunVisualSearchOnlineInput): Promise<VisualSearchOnlineResult> {
  if (artifact.key !== "fashnForegroundCrop") {
    throw new Error("Online search requires artifact 08_fashn_foreground_crop.png")
  }
  const { normalizedEndpoint, normalizedToken } = getEndpointAndToken(endpoint, token)
  const artifactResponse = await fetch(artifact.dataUrl)
  if (!artifactResponse.ok) throw new Error("Unable to read the FASHN foreground crop")
  const crop = await artifactResponse.blob()

  const form = new FormData()
  form.set("image", crop, artifact.filename)
  form.set("category", category)
  form.set("country", country)

  const response = await fetch(`${normalizedEndpoint}/search-online`, {
    method: "POST",
    headers: { "X-Visual-Search-Token": normalizedToken },
    body: form,
  })
  const payload = await response.json().catch(() => ({})) as VisualSearchOnlineResult & {
    detail?: string
    error?: string
  }
  if (!response.ok) {
    throw new Error(payload.detail ?? payload.error ?? `Online garment search failed (${response.status})`)
  }
  return payload
}
