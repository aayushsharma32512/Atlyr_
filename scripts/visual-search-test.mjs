#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, extname, resolve } from "node:path"

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current.startsWith("--")) continue
    args[current.slice(2)] = argv[index + 1]
    index += 1
  }
  return args
}

function usage() {
  return [
    "Usage:",
    "  npm run test:visual-search -- --image ./photo.jpg --category upper",
    "",
    "Required environment:",
    "  VISUAL_SEARCH_TEST_URL   Modal web URL (the app root, without /search)",
    "  VISUAL_SEARCH_TEST_TOKEN Token stored in the Modal visual-search-test secret",
    "",
    "Options:",
    "  --category upper|lower|shoes  Required",
    "  --threshold 0.75              Optional catalog similarity floor",
    "  --count 12                    Optional maximum results",
    "  --output ./tmp/visual-search  Optional output directory",
  ].join("\n")
}

const args = parseArgs(process.argv.slice(2))
if (!args.image || !["upper", "lower", "shoes"].includes(args.category)) {
  console.error(usage())
  process.exit(1)
}

const endpoint = (args.endpoint || process.env.VISUAL_SEARCH_TEST_URL || "").replace(/\/$/, "")
const token = args.token || process.env.VISUAL_SEARCH_TEST_TOKEN
if (!endpoint || !token) {
  console.error("Missing VISUAL_SEARCH_TEST_URL or VISUAL_SEARCH_TEST_TOKEN.\n")
  console.error(usage())
  process.exit(1)
}

const imagePath = resolve(args.image)
const imageBytes = await readFile(imagePath)
const extension = extname(imagePath).toLowerCase()
const contentType = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}[extension]
if (!contentType) throw new Error("Image must be JPEG, PNG, or WebP")

const form = new FormData()
form.set("image", new Blob([imageBytes], { type: contentType }), basename(imagePath))
form.set("category", args.category)
form.set("threshold", args.threshold || "0.75")
form.set("count", args.count || "12")

console.log(`Running ${args.category} visual search for ${imagePath}...`)
const response = await fetch(`${endpoint}/search`, {
  method: "POST",
  headers: { "X-Visual-Search-Token": token },
  body: form,
})
const payload = await response.json()
if (!response.ok) {
  throw new Error(payload.detail || payload.error || `Visual search failed with ${response.status}`)
}

const outputDir = resolve(args.output || "tmp/visual-search")
await mkdir(outputDir, { recursive: true })
const decodeDataUrl = (dataUrl) => Buffer.from(dataUrl.split(",")[1], "base64")
await Promise.all([
  writeFile(resolve(outputDir, "cutout.png"), decodeDataUrl(payload.cutoutDataUrl)),
  writeFile(resolve(outputDir, "original-crop.png"), decodeDataUrl(payload.queryImages.originalCropDataUrl)),
  writeFile(resolve(outputDir, "cutout-crop.png"), decodeDataUrl(payload.queryImages.segmentedCutoutDataUrl)),
  writeFile(resolve(outputDir, "results.json"), `${JSON.stringify(payload, null, 2)}\n`),
])

console.log(`Detector: ${payload.detector}`)
console.log(`Candidates: ${payload.candidates.length}`)
console.log(`Timings: ${JSON.stringify(payload.timingsMs)}`)
console.log(`Wrote ${resolve(outputDir, "cutout.png")}`)
console.log(`Wrote ${resolve(outputDir, "original-crop.png")}`)
console.log(`Wrote ${resolve(outputDir, "cutout-crop.png")}`)
console.log(`Wrote ${resolve(outputDir, "results.json")}`)
