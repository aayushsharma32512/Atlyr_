/**
 * Turns a product cutout (a transparent PNG/WebP served from public storage)
 * into the crop the import pipeline searches with.
 *
 * Two constraints shape it. The detector and Google Lens both see RGB, so the
 * alpha is dropped and whatever sits under the transparent pixels shows —
 * usually black; compositing onto white here gives them a garment on a clean
 * field. And the web search posts the crop to Lens with a 500 KB ceiling, so
 * the image is bounded to 512px on its long edge (the detector's own crop
 * size) and encoded as WebP.
 */
const MAX_EDGE = 512
const MAX_BYTES = 500 * 1024

export const CUTOUT_MIME = "image/webp"

export async function cutoutToFile(url: string): Promise<File> {
  console.log("[find-items] 1/5 fetching cutout", { url })
  const response = await fetch(url, { mode: "cors" })
  if (!response.ok) throw new Error("Couldn't load this piece's image.")
  const blob = await response.blob()
  console.log("[find-items] 1/5 cutout fetched", { bytes: blob.size, type: blob.type })

  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Couldn't prepare this piece's image.")
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    // Step the quality down until it fits under the Lens ceiling.
    for (const quality of [0.86, 0.72, 0.6, 0.45]) {
      const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, CUTOUT_MIME, quality))
      if (!encoded) break
      if (encoded.size <= MAX_BYTES) {
        console.log("[find-items] 2/5 crop prepared", { width: canvas.width, height: canvas.height, bytes: encoded.size, quality })
        return new File([encoded], "piece.webp", { type: CUTOUT_MIME })
      }
    }
    throw new Error("This piece's image is too large to search with.")
  } finally {
    bitmap.close()
  }
}
