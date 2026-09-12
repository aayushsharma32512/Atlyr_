/**
 * Opaque bounding box of a mostly-transparent garment PNG, as fractions of the
 * image (0..1) so it survives any later scaling, plus the image's aspect.
 *
 * Garment cutouts are authored on the full placement canvas, so the image's rect
 * and the garment the eye sees are very different boxes — a pair of shoes is a
 * 2.5% sliver at the bottom of a 1536x2752 canvas. Anything framing the garment
 * has to use these bounds or it draws mostly empty space.
 *
 * Lives in the design system because both app surfaces and the placement editor
 * need it; `features/studio/utils/imageAlphaBounds` re-exports it.
 */
export type AlphaBounds = { x: number; y: number; w: number; h: number }

export const FULL_BOUNDS: AlphaBounds = { x: 0, y: 0, w: 1, h: 1 }

export type GarmentBounds = AlphaBounds & {
  /** width / height of the source image. */
  aspect: number
}

export const FULL_GARMENT_BOUNDS: GarmentBounds = { ...FULL_BOUNDS, aspect: 1 }

const ALPHA_CUTOFF = 12
const SAMPLE = 256

/**
 * Share of the opaque mass to trim off each edge before taking the box.
 *
 * A raw min/max box is decided by the single most extreme pixel, so a few faint
 * specks of segmentation noise stretch it across the whole image: one asset
 * measured 2% opaque pixels but a 25%-wide box, which scaled the garment to a
 * useless 1.2x. Dropping the outermost 0.5% of mass ignores the specks and is a
 * no-op on a clean cutout (0.025 -> 0.024 area) and on a photo (1.0 -> 0.99).
 */
const EDGE_TRIM = 0.005

/** First and last index holding all but `frac` of the mass at each end. */
export function trimmedRange(counts: number[], total: number, frac = EDGE_TRIM): [number, number] {
  if (total <= 0 || counts.length === 0) return [0, Math.max(0, counts.length - 1)]
  const budget = total * frac

  let lo = 0
  let dropped = 0
  while (lo < counts.length - 1 && dropped + counts[lo] <= budget) {
    dropped += counts[lo]
    lo++
  }

  let hi = counts.length - 1
  dropped = 0
  while (hi > lo && dropped + counts[hi] <= budget) {
    dropped += counts[hi]
    hi--
  }
  return [lo, hi]
}

export async function probeAlphaBounds(url: string): Promise<AlphaBounds> {
  const { x, y, w, h } = await probeGarmentBounds(url)
  return { x, y, w, h }
}

export async function probeGarmentBounds(url: string): Promise<GarmentBounds> {
  try {
    const img = await loadImage(url)
    const aspect = img.height > 0 ? img.width / img.height : 1
    const scale = Math.min(1, SAMPLE / Math.max(img.width, img.height))
    const cw = Math.max(1, Math.round(img.width * scale))
    const ch = Math.max(1, Math.round(img.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return { ...FULL_BOUNDS, aspect }
    ctx.drawImage(img, 0, 0, cw, ch)

    const { data } = ctx.getImageData(0, 0, cw, ch)
    // Per-axis opaque mass, so the box can ignore outlying specks.
    const cols = new Array<number>(cw).fill(0)
    const rows = new Array<number>(ch).fill(0)
    let total = 0
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] <= ALPHA_CUTOFF) continue
        cols[x]++
        rows[y]++
        total++
      }
    }
    if (total === 0) return { ...FULL_BOUNDS, aspect }

    const [minX, maxX] = trimmedRange(cols, total)
    const [minY, maxY] = trimmedRange(rows, total)

    return {
      x: minX / cw,
      y: minY / ch,
      w: (maxX - minX + 1) / cw,
      h: (maxY - minY + 1) / ch,
      aspect,
    }
  } catch {
    // Tainted canvas, CORS, decode failure — fall back to the whole image.
    return FULL_GARMENT_BOUNDS
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
