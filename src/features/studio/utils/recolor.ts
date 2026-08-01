import { melaninGain, pixelTone, retoneChannel } from "@/shared/skin/melanin"

/**
 * Recolouring photoreal imagery while keeping its shading.
 *
 * Hair and skin use fundamentally different methods, because they are different problems:
 *
 *  - HAIR is "replace the material". Blonde and black differ enormously in lightness, so a luminance
 *    gradient map — keep the strand detail, rebuild the colour along a shadow → base → highlight
 *    ramp — is the right tool, and it works well.
 *
 *  - SKIN is "change the melanin". That is a physical process, not an artistic one, and modelling it
 *    as such removed an entire class of bug. See the note above `recolorSkin`.
 *
 * The shared enemy is Pixi's `Sprite.tint`, a multiply: `out = src * colour`, which can only ever
 * DARKEN and muddies everything because it stacks a hue on top of the original.
 */

/** sRGB luma. Weighted for perception, so highlights read as highlights. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().toLowerCase()
  if (!h.startsWith("#")) h = `#${h}`
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  if (!/^#[0-9a-f]{6}$/.test(h)) return null
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  }
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t

const cache = new Map<string, HTMLCanvasElement>()

/**
 * Body vs background.
 *
 * `female.png` is transparent-backed but `male.png` is WHITE-backed, so the brightness test is what
 * carries the male case and cannot be dropped in favour of an alpha test alone.
 */
const isSkinPixel = (d: Uint8ClampedArray, i: number) =>
  d[i + 3] >= 32 && luma(d[i], d[i + 1], d[i + 2]) < 245

function readPixels(img: HTMLImageElement) {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  return { canvas, ctx, image: ctx.getImageData(0, 0, w, h) }
}

// ── Skin ────────────────────────────────────────────────────────────────────────────────────────

/** Mean position of an image's skin along the melanin axis — i.e. the tone it was shot at. */
function measureSkinTone(img: HTMLImageElement): number | null {
  const read = readPixels(img)
  if (!read) return null
  const d = read.image.data
  let sum = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (!isSkinPixel(d, i)) continue
    sum += pixelTone(d[i], d[i + 1], d[i + 2])
    n++
  }
  return n ? sum / n : null
}

/**
 * Retone skin to a position on the melanin axis.
 *
 * ── Why this and not a colour transform ────────────────────────────────────────────────────────
 * Skin colour is pigment absorption, which follows Beer-Lambert: observed light is illumination
 * multiplied by transmittance, and transmittance falls exponentially with pigment concentration. In
 * log optical density the components are therefore additive, and changing melanin is a translation
 * along a fixed axis — which back in linear RGB is a constant per-channel GAIN.
 *
 * Two properties follow, and they are why this replaced four failed attempts (tint, an HSL gradient
 * map, CIELAB with L* scaled, CIELAB with L* offset):
 *
 *   1. Shading survives BY CONSTRUCTION. Illumination is multiplicative too and multiplication
 *      commutes, so scaling pigment cannot disturb the shading factor. The flat-silhouette and
 *      blown-highlight failures are structurally impossible here rather than defended against.
 *   2. There is nothing to tune. The earlier attempts needed a saturation floor, a chroma floor and
 *      a contrast minimum — all of them hand-simulating statistics that a physical model just has.
 *
 * Reference: Tsumura et al., "Independent-component analysis of skin color image", JOSA A 16(9),
 * 1999, and the SIGGRAPH 2003 melanin/haemoglobin synthesis work built on it.
 */
export function recolorSkin(img: HTMLImageElement, tone: number): HTMLCanvasElement | null {
  const key = `${img.src}|skin|${tone.toFixed(4)}`
  const hit = cache.get(key)
  if (hit) return hit

  const base = measureSkinTone(img)
  if (base === null) return null

  const read = readPixels(img)
  if (!read) return null
  const { canvas, ctx, image } = read
  const d = image.data

  const gain = melaninGain(tone - base)

  for (let i = 0; i < d.length; i += 4) {
    if (!isSkinPixel(d, i)) continue
    d[i] = retoneChannel(d[i], gain[0])
    d[i + 1] = retoneChannel(d[i + 1], gain[1])
    d[i + 2] = retoneChannel(d[i + 2], gain[2])
  }

  ctx.putImageData(image, 0, 0)
  cache.set(key, canvas)
  return canvas
}

// ── Hair ────────────────────────────────────────────────────────────────────────────────────────

/**
 * How far the hair ramp reaches into shadow and highlight.
 *
 * Hair genuinely does fall to near-black and blow out to near-white, so unlike skin a gradient map
 * is the right model here — it is a material replacement, not a pigment shift.
 */
const HAIR_RAMP = { shadow: 0.16, highlight: 0.72, trim: 0.02 }

/**
 * Recolour hair by luminance gradient map.
 *
 * Reduce each pixel to luminance — the strand detail, shading and specular highlights, everything
 * worth keeping — normalise against the hair's OWN range, then rebuild colour along a
 * shadow → target → highlight ramp. Blonde works because the highlight end approaches white, which a
 * multiply could never reach.
 */
export function recolorHair(img: HTMLImageElement, hex: string): HTMLCanvasElement | null {
  const key = `${img.src}|hair|${hex}`
  const hit = cache.get(key)
  if (hit) return hit

  const target = hexToRgb(hex)
  if (!target) return null

  const read = readPixels(img)
  if (!read) return null
  const { canvas, ctx, image } = read
  const d = image.data

  // Normalise against the hair's own luminance range, not 0-255. A dark brown bake occupies maybe
  // 20-120; stretching that range to the full ramp is what recovers contrast instead of producing a
  // flat wash. Percentiles rather than min/max so a few stray pixels cannot set the range.
  const hist = new Int32Array(256)
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 32) continue
    hist[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++
    n++
  }
  if (!n) return null

  let acc = 0
  let lo = 0
  let hi = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= n * HAIR_RAMP.trim) { lo = v; break }
  }
  acc = 0
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]
    if (acc >= n * HAIR_RAMP.trim) { hi = v; break }
  }
  if (hi - lo < 8) hi = lo + 8

  const shadow = {
    r: target.r * HAIR_RAMP.shadow,
    g: target.g * HAIR_RAMP.shadow,
    b: target.b * HAIR_RAMP.shadow,
  }
  const highlight = {
    r: mix(target.r, 255, HAIR_RAMP.highlight),
    g: mix(target.g, 255, HAIR_RAMP.highlight),
    b: mix(target.b, 255, HAIR_RAMP.highlight),
  }

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const t = Math.min(1, Math.max(0, (luma(d[i], d[i + 1], d[i + 2]) - lo) / (hi - lo)))
    if (t < 0.5) {
      const k = t * 2
      d[i] = mix(shadow.r, target.r, k)
      d[i + 1] = mix(shadow.g, target.g, k)
      d[i + 2] = mix(shadow.b, target.b, k)
    } else {
      const k = (t - 0.5) * 2
      d[i] = mix(target.r, highlight.r, k)
      d[i + 1] = mix(target.g, highlight.g, k)
      d[i + 2] = mix(target.b, highlight.b, k)
    }
  }

  ctx.putImageData(image, 0, 0)
  cache.set(key, canvas)
  return canvas
}
