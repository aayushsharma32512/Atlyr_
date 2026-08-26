import { useEffect, useState, type FormEvent } from "react"
import { BoxSelect, Footprints, ScanSearch, Shirt, Upload } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useVisualSearchTest } from "@/features/visual-search/hooks/useVisualSearchTest"
import type {
  GroundingDinoDetection,
  VisualSearchCategory,
} from "@/services/visualSearch/visualSearchTestService"

const categories: Array<{
  value: VisualSearchCategory
  label: string
  description: string
  icon: typeof Shirt
}> = [
  { value: "upper", label: "Upper", description: "FASHN top + upper-garment DINO prompts", icon: Shirt },
  { value: "lower", label: "Lower", description: "FASHN skirt/pants + lower-garment prompts", icon: Shirt },
  { value: "shoes", label: "Shoes", description: "FASHN feet proxy + footwear DINO prompts", icon: Footprints },
]

const defaultEndpoint = import.meta.env.VITE_VISUAL_SEARCH_TEST_URL ?? ""

function formatBox(box: [number, number, number, number] | null) {
  return box ? box.join(", ") : "Not detected"
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`
}

function DetectionCard({ detection, index }: { detection: GroundingDinoDetection; index: number }) {
  return (
    <Card className={detection.selected ? "border-primary" : undefined}>
      <CardContent className="space-y-2 pt-5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">#{index + 1} {detection.label}</p>
          <div className="flex gap-2">
            {!detection.eligible && <Badge variant="outline">Rejected</Badge>}
            {detection.selected && <Badge>Selected</Badge>}
          </div>
        </div>
        <p className="text-muted-foreground">Confidence {(detection.score * 100).toFixed(1)}%</p>
        <p className="font-mono text-xs">Box [{detection.box.join(", ")}]</p>
        <p className="text-xs text-muted-foreground">
          FASHN coverage {percentage(detection.maskCoverage)} · Box precision {percentage(detection.boxPrecision)}
        </p>
      </CardContent>
    </Card>
  )
}

export default function VisualSearchTestScreen() {
  const mutation = useVisualSearchTest()
  const [endpoint, setEndpoint] = useState(defaultEndpoint)
  const [token, setToken] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<VisualSearchCategory>("upper")
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
    mutation.mutate({ endpoint, token, file, category })
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Hypothesis test</Badge>
            <Badge variant="secondary">FASHN + GroundingDINO only</Badge>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Visual-search localization diagnostics</h1>
          <p className="mt-2 max-w-4xl text-muted-foreground">
            Inspect raw FASHN segments, category masks, GroundingDINO boxes, the selected crop, and coarse background removal. This test does not run SAM2, generate embeddings, or write to Supabase.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Run a diagnostic</CardTitle>
              <CardDescription>The test token stays in memory and is never persisted.</CardDescription>
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
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>
                          <span className="block">{label}</span>
                          <span className="block text-xs font-normal text-muted-foreground">{description}</span>
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
                <Button className="w-full" type="submit" disabled={!file || mutation.isPending}>
                  {mutation.isPending ? <Upload className="animate-pulse" /> : <ScanSearch />}
                  {mutation.isPending ? "Running models…" : "Analyze localization"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <section className="space-y-6">
            {mutation.error && (
              <Alert variant="destructive">
                <AlertTitle>Diagnostic failed</AlertTitle>
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            )}

            {!mutation.data && !mutation.isPending && (
              <Card className="flex min-h-80 items-center justify-center border-dashed">
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <BoxSelect className="mx-auto mb-3 h-8 w-8" />
                  Intermediate masks and boxes will appear here.
                </CardContent>
              </Card>
            )}

            {mutation.isPending && (
              <Card className="flex min-h-80 items-center justify-center">
                <CardContent className="pt-6 text-center">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                  FASHN and GroundingDINO can take several minutes on a cold container.
                </CardContent>
              </Card>
            )}

            {mutation.data && (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Box source</CardDescription>
                      <CardTitle className="text-base">{mutation.data.boxSource.split("_").join(" + ")}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>FASHN target coverage</CardDescription>
                      <CardTitle className="text-base">{percentage(mutation.data.fashn.targetCoverage)}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>DINO detections</CardDescription>
                      <CardTitle className="text-base">{mutation.data.groundingDino.detections.length}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Analysis time</CardDescription>
                      <CardTitle className="text-base">{mutation.data.timingsMs.total.toLocaleString()} ms</CardTitle>
                    </CardHeader>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Localization decision</CardTitle>
                    <CardDescription>
                      Target classes {mutation.data.targetClasses.map((item) => `${item.id}:${item.label}`).join(", ")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                    <p><span className="text-muted-foreground">Image:</span> {mutation.data.imageSize.width} × {mutation.data.imageSize.height}</p>
                    <p><span className="text-muted-foreground">FASHN box:</span> [{formatBox(mutation.data.fashn.box)}]</p>
                    <p><span className="text-muted-foreground">Final padded box:</span> [{formatBox(mutation.data.finalBox)}]</p>
                    <p><span className="text-muted-foreground">All foreground coverage:</span> {percentage(mutation.data.fashn.foregroundCoverage)}</p>
                    <p><span className="text-muted-foreground">FASHN time:</span> {mutation.data.timingsMs.fashn.toLocaleString()} ms</p>
                    <p><span className="text-muted-foreground">GroundingDINO time:</span> {mutation.data.timingsMs.groundingDino.toLocaleString()} ms</p>
                    <p>
                      <span className="text-muted-foreground">FASHN target usable:</span>{" "}
                      {mutation.data.fashn.usable ? "Yes" : `No (${mutation.data.fashn.targetPixels} / ${mutation.data.fashn.minimumTargetPixels} pixels)`}
                    </p>
                  </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {mutation.data.artifacts.map((artifact) => (
                    <Card key={artifact.key} className="overflow-hidden">
                      <img
                        src={artifact.dataUrl}
                        alt={artifact.title}
                        className="aspect-square w-full border-b bg-white object-contain [image-rendering:auto]"
                      />
                      <CardHeader>
                        <CardTitle className="text-base">{artifact.title}</CardTitle>
                        <CardDescription>{artifact.description}</CardDescription>
                      </CardHeader>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>GroundingDINO detections</CardTitle>
                    <CardDescription>
                      The selected box must overlap the FASHN target when a usable FASHN mask exists. If FASHN is empty, the highest-confidence DINO box is selected.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {mutation.data.groundingDino.detections.length > 0 ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {mutation.data.groundingDino.detections.map((detection, index) => (
                          <DetectionCard key={`${detection.label}-${detection.box.join("-")}-${index}`} detection={detection} index={index} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No category-scoped DINO boxes cleared the detector thresholds.</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>FASHN class pixels</CardTitle>
                    <CardDescription>Non-zero classes found anywhere in the source image.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
                    {Object.entries(mutation.data.classPixelCounts).map(([label, count]) => (
                      <div key={label} className="rounded-md border p-3">
                        <p className="font-medium capitalize">{label}</p>
                        <p className="text-xs text-muted-foreground">{count.toLocaleString()} pixels</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
