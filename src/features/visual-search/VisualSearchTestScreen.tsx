import { useEffect, useState, type FormEvent } from "react"
import { Footprints, Search, Shirt, Upload } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useVisualSearchTest } from "@/features/visual-search/hooks/useVisualSearchTest"
import type {
  VisualSearchCandidate,
  VisualSearchCategory,
} from "@/services/visualSearch/visualSearchTestService"

const categories: Array<{
  value: VisualSearchCategory
  label: string
  description: string
  icon: typeof Shirt
}> = [
  { value: "upper", label: "Upper", description: "Tops, shirts, jackets", icon: Shirt },
  { value: "lower", label: "Lower", description: "Pants, skirts, shorts", icon: Shirt },
  { value: "shoes", label: "Shoes", description: "Footwear", icon: Footprints },
]

const defaultEndpoint = import.meta.env.VITE_VISUAL_SEARCH_TEST_URL ?? ""

function formatPrice(price: number | null, currency: string | null) {
  if (price == null) return "Price unavailable"
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    maximumFractionDigits: 0,
  }).format(price)
}

function similarityLabel(similarity: number | null | undefined) {
  return similarity == null ? "—" : `${Math.round(similarity * 100)}%`
}

function CandidateGrid({ candidates, fused = false }: { candidates: VisualSearchCandidate[]; fused?: boolean }) {
  if (candidates.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No products cleared this similarity threshold.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {candidates.map((candidate) => (
        <Card key={candidate.id} className="overflow-hidden">
          {candidate.thumbnail_url || candidate.image_url ? (
            <img
              src={candidate.thumbnail_url || candidate.image_url || undefined}
              alt={candidate.product_name || "Catalog product"}
              className="aspect-[4/5] w-full bg-muted object-contain"
            />
          ) : (
            <div className="flex aspect-[4/5] items-center justify-center bg-muted text-sm text-muted-foreground">
              No product image
            </div>
          )}
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-start justify-between gap-2">
              <p className="line-clamp-2 font-medium">
                {candidate.product_name || candidate.type_category || "Unnamed product"}
              </p>
              <Badge variant="outline">{similarityLabel(candidate.similarity)}</Badge>
            </div>
            {fused && (
              <p className="text-xs text-muted-foreground">
                Crop {similarityLabel(candidate.original_crop_similarity)} · Cutout {similarityLabel(candidate.segmented_cutout_similarity)}
              </p>
            )}
            <p className="text-sm text-muted-foreground">{candidate.brand || "Unknown brand"}</p>
            <p className="text-sm font-medium">{formatPrice(candidate.price, candidate.currency)}</p>
            {candidate.product_url && (
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={candidate.product_url} target="_blank" rel="noreferrer">Open product</a>
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function VisualSearchTestScreen() {
  const mutation = useVisualSearchTest()
  const [endpoint, setEndpoint] = useState(defaultEndpoint)
  const [token, setToken] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<VisualSearchCategory>("upper")
  const [threshold, setThreshold] = useState("0.75")

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return undefined
    }
    const nextPreviewUrl = URL.createObjectURL(file)
    setPreviewUrl(nextPreviewUrl)
    return () => URL.revokeObjectURL(nextPreviewUrl)
  }, [file])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!file) return
    mutation.mutate({
      endpoint,
      token,
      file,
      category,
      threshold: Number(threshold),
    })
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <Badge variant="outline">Temporary test surface</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Visual search pipeline</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Upload one image, choose the garment, and compare contextual-crop and isolated-cutout retrieval.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Run a test</CardTitle>
              <CardDescription>The token stays in this page&apos;s memory and is never persisted.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="visual-search-endpoint">Modal endpoint</Label>
                  <Input
                    id="visual-search-endpoint"
                    type="url"
                    placeholder="https://…modal.run"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="visual-search-token">Test token</Label>
                  <Input
                    id="visual-search-token"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="visual-search-file">Image</Label>
                  <Input
                    id="visual-search-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    required
                  />
                  {previewUrl && (
                    <img src={previewUrl} alt="Selected source" className="aspect-[4/5] w-full rounded-md border object-contain" />
                  )}
                </div>
                <div className="space-y-3">
                  <Label>Garment category</Label>
                  <RadioGroup value={category} onValueChange={(value) => setCategory(value as VisualSearchCategory)}>
                    {categories.map(({ value, label, description, icon: Icon }) => (
                      <Label
                        key={value}
                        htmlFor={`visual-category-${value}`}
                        className="flex cursor-pointer items-center gap-3 rounded-md border p-3"
                      >
                        <RadioGroupItem id={`visual-category-${value}`} value={value} />
                        <Icon className="h-4 w-4" />
                        <span>
                          <span className="block">{label}</span>
                          <span className="block text-xs font-normal text-muted-foreground">{description}</span>
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="visual-search-threshold">Similarity threshold</Label>
                  <Input
                    id="visual-search-threshold"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={threshold}
                    onChange={(event) => setThreshold(event.target.value)}
                  />
                </div>
                <Button className="w-full" type="submit" disabled={!file || mutation.isPending}>
                  {mutation.isPending ? <Upload className="animate-pulse" /> : <Search />}
                  {mutation.isPending ? "Running pipeline…" : "Segment and search"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <section className="space-y-6">
            {mutation.error && (
              <Alert variant="destructive">
                <AlertTitle>Pipeline failed</AlertTitle>
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            )}

            {!mutation.data && !mutation.isPending && (
              <Card className="flex min-h-80 items-center justify-center border-dashed">
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <Upload className="mx-auto mb-3 h-8 w-8" />
                  Results will appear here.
                </CardContent>
              </Card>
            )}

            {mutation.isPending && (
              <Card className="flex min-h-80 items-center justify-center">
                <CardContent className="pt-6 text-center">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                  GPU segmentation can take a few minutes on a cold container.
                </CardContent>
              </Card>
            )}

            {mutation.data && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle>Query representations</CardTitle>
                      <Badge variant="secondary">{mutation.data.detector}</Badge>
                    </div>
                    <CardDescription>
                      {mutation.data.timingsMs.total.toLocaleString()} ms total · {mutation.data.candidates.length} fused matches
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Original garment crop</p>
                      <img
                        src={mutation.data.queryImages.originalCropDataUrl}
                        alt="Original garment crop used as the primary search query"
                        className="aspect-square w-full rounded-md border object-contain"
                      />
                      <p className="text-xs text-muted-foreground">Primary embedding; preserves real occluders.</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">White cutout crop</p>
                      <img
                        src={mutation.data.queryImages.segmentedCutoutDataUrl}
                        alt="White-composited segmented garment crop used as a secondary query"
                        className="aspect-square w-full rounded-md border object-contain"
                      />
                      <p className="text-xs text-muted-foreground">Secondary embedding; transparency is composited.</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Raw segmentation</p>
                      <img
                        src={mutation.data.cutoutDataUrl}
                        alt="Raw segmented garment diagnostic"
                        className="aspect-square w-full rounded-md border bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:20px_20px] object-contain"
                      />
                      <p className="text-xs text-muted-foreground">Diagnostic only; this full canvas is not embedded.</p>
                    </div>
                  </CardContent>
                </Card>

                <Tabs defaultValue="fused" className="space-y-4">
                  <TabsList className="grid h-auto w-full grid-cols-3">
                    <TabsTrigger value="fused">Fused</TabsTrigger>
                    <TabsTrigger value="crop">Original crop</TabsTrigger>
                    <TabsTrigger value="cutout">White cutout</TabsTrigger>
                  </TabsList>
                  <TabsContent value="fused">
                    <CandidateGrid candidates={mutation.data.candidates} fused />
                  </TabsContent>
                  <TabsContent value="crop">
                    <CandidateGrid candidates={mutation.data.candidateSets.originalCrop} />
                  </TabsContent>
                  <TabsContent value="cutout">
                    <CandidateGrid candidates={mutation.data.candidateSets.segmentedCutout} />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
