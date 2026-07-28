/**
 * Opaque bounding box of a mostly-transparent garment PNG, returned as fractions of the image
 * (0..1) so it survives any later scaling.
 *
 * Garment cutouts carry a lot of transparent padding, so the image's rect and the garment the eye
 * sees are very different boxes. Anything drawing UI around the garment — a selection gizmo, a
 * handle — has to use these bounds or it lands in empty space.
 *
 * Same alpha probe the placement mesh editor and PlacementAvatarRenderer use on the 3D path; those
 * two work in texture pixels, this returns fractions for the DOM/CSS path.
 */
export type AlphaBounds = { x: number; y: number; w: number; h: number }

export const FULL_BOUNDS: AlphaBounds = { x: 0, y: 0, w: 1, h: 1 }

const ALPHA_CUTOFF = 12
const SAMPLE = 256

export async function probeAlphaBounds(url: string): Promise<AlphaBounds> {
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, SAMPLE / Math.max(img.width, img.height))
    const cw = Math.max(1, Math.round(img.width * scale))
    const ch = Math.max(1, Math.round(img.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return FULL_BOUNDS
    ctx.drawImage(img, 0, 0, cw, ch)

    const { data } = ctx.getImageData(0, 0, cw, ch)
    let minX = cw, minY = ch, maxX = -1, maxY = -1
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] <= ALPHA_CUTOFF) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) return FULL_BOUNDS

    return {
      x: minX / cw,
      y: minY / ch,
      w: (maxX - minX + 1) / cw,
      h: (maxY - minY + 1) / ch,
    }
  } catch {
    // Tainted canvas, CORS, decode failure — fall back to the whole image.
    return FULL_BOUNDS
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = "anonymous"
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("image load failed"))
    el.src = url
  })
}
