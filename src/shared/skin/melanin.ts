/**
 * The melanin model: skin tone as a position on one axis, plus the colour maths that moves along it.
 *
 * A tone here is a SCALAR, not a colour. That is the important idea. Every earlier attempt treated
 * skin tone as "a hex to transform toward", and a flat swatch carries no distribution — no spread,
 * no undertone, no highlight behaviour — so the transform had to hand-simulate all of it with tuned
 * floors and ceilings, and looked wrong at both ends of the range regardless.
 *
 * Modelling it physically instead: skin colour is pigment absorption, and by Beer-Lambert the
 * components are additive in log optical density. Changing melanin is therefore a translation along
 * one fixed direction, which back in linear RGB is a constant per-channel GAIN. Shading survives by
 * construction, because illumination is multiplicative too and multiplication commutes.
 *
 * Reference: Tsumura et al., "Independent-component analysis of skin color image", JOSA A 16(9),
 * 1999, and the SIGGRAPH 2003 melanin/haemoglobin synthesis work built on it.
 *
 * Deliberately free of DOM types so the offline preview script can import the identical maths rather
 * than keeping a second copy that drifts. Pixel access lives in features/studio/utils/recolor.
 */

/**
 * Reference skin colours spanning the tone range.
 *
 * Used ONLY to fit the axis direction and to place the tone steps along it — never as colours to
 * transform toward. That distinction is what makes this work where matching a chip directly did not.
 *
 * Chosen over the Monk scale because they suit the user base (the wheatish band is where most of it
 * sits, and MST steps through that range coarsely) and stay chromatic throughout, whereas MST's
 * extremes are near-neutral — MST 10 is chroma ~5 — which skewed the fitted axis toward grey.
 *
 * The extremes of the original ten were dropped after looking at them on the mannequin. The pale
 * chips needed gains of 2.0-2.7x, past what the highlight shoulder can absorb, so the chest and
 * shoulders washed out; the deepest needed a gain down to 0.07, which flattens the figure for the
 * same reason in reverse.
 *
 * That range limit is a property of THIS PHOTOGRAPH, not of the method: an image carries only so
 * much latitude, and asking it to travel further leaves nothing behind. Widening the palette means a
 * second mannequin shot at a different base tone, with the transform covering the span around each —
 * no colour transform will get there from this one image.
 */
const SKIN_REFERENCE_CHIPS = [
  { step: 1, label: "Light wheatish", hex: "#E2C0A3" },
  { step: 2, label: "Wheatish", hex: "#D5AA87" },
  { step: 3, label: "Medium wheatish", hex: "#C5936D" },
  { step: 4, label: "Tan", hex: "#B37C58" },
  { step: 5, label: "Medium brown", hex: "#9B6546" },
  { step: 6, label: "Brown", hex: "#84513A" },
  { step: 7, label: "Dark brown", hex: "#69402E" },
]

// ── sRGB ↔ linear light ─────────────────────────────────────────────────────────────────────────
// The gain must be applied in LINEAR light. Doing it in sRGB is what made the original `tint`
// attempt look muddy.

export const srgbToLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

export const linearToSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

/** Optical density. Floored so pure black cannot produce infinities. */
const OD_EPS = 1e-4
export const toOpticalDensity = (linear: number) => -Math.log(Math.max(linear, OD_EPS))

function hexToOD(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [toOpticalDensity(srgbToLinear(r)), toOpticalDensity(srgbToLinear(g)), toOpticalDensity(srgbToLinear(b))]
}

/**
 * Principal direction through the chips in log-OD space — the melanin axis.
 *
 * Fitted at module load rather than hardcoded so it can never drift from the chip list it came from;
 * it is a handful of points and a 3x3 covariance, so the cost is microseconds. Power iteration
 * converges far past the precision that matters in three dimensions.
 */
function fitMelaninAxis(hexes: string[]): [number, number, number] {
  const pts = hexes.map(hexToOD)
  const mean = [0, 1, 2].map((c) => pts.reduce((s, p) => s + p[c], 0) / pts.length)

  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const p of pts) {
    const dv = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += dv[i] * dv[j]
  }

  let v = [1, 1, 1]
  for (let iter = 0; iter < 200; iter++) {
    const nx = [0, 1, 2].map((i) => cov[i][0] * v[0] + cov[i][1] * v[1] + cov[i][2] * v[2])
    const len = Math.hypot(nx[0], nx[1], nx[2])
    if (len < 1e-12) break
    v = nx.map((x) => x / len)
  }
  // Orient so a positive delta means MORE melanin — darker, higher optical density.
  if (v[0] + v[1] + v[2] < 0) v = v.map((x) => -x)
  return [v[0], v[1], v[2]]
}

/** Unit direction of increasing melanin in log optical density. */
export const MELANIN_AXIS: readonly [number, number, number] = fitMelaninAxis(
  SKIN_REFERENCE_CHIPS.map((c) => c.hex),
)

/** Where a colour sits along the melanin axis. */
export function projectHexToTone(hex: string): number | null {
  let h = hex.trim().toLowerCase()
  if (!h.startsWith("#")) h = `#${h}`
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  if (!/^#[0-9a-f]{6}$/.test(h)) return null
  const od = hexToOD(h)
  return od[0] * MELANIN_AXIS[0] + od[1] * MELANIN_AXIS[1] + od[2] * MELANIN_AXIS[2]
}

/** Where an already-linearised pixel sits along the axis. */
export function pixelTone(r: number, g: number, b: number): number {
  return toOpticalDensity(srgbToLinear(r)) * MELANIN_AXIS[0]
    + toOpticalDensity(srgbToLinear(g)) * MELANIN_AXIS[1]
    + toOpticalDensity(srgbToLinear(b)) * MELANIN_AXIS[2]
}

/** Per-channel linear-light gain that moves skin by `delta` along the melanin axis. */
export function melaninGain(delta: number): [number, number, number] {
  return [
    Math.exp(-MELANIN_AXIS[0] * delta),
    Math.exp(-MELANIN_AXIS[1] * delta),
    Math.exp(-MELANIN_AXIS[2] * delta),
  ]
}

/**
 * Soft highlight shoulder, in linear light.
 *
 * Lightening needs gains above 1, which pushes specular highlights past 1.0 where they hard-clip and
 * the chest and shoulders go flat white. Rolling off above the knee compresses them into [knee, 1]
 * instead. Continuous in value AND slope at the knee, so nothing below it is altered and no seam
 * appears.
 */
const SHOULDER_KNEE = 0.7
export function shoulder(x: number): number {
  if (x <= SHOULDER_KNEE) return x
  const range = 1 - SHOULDER_KNEE
  return SHOULDER_KNEE + range * (1 - Math.exp(-(x - SHOULDER_KNEE) / range))
}

/** Apply a melanin delta to one sRGB channel. */
export function retoneChannel(srgb: number, gain: number): number {
  return linearToSrgb(shoulder(srgbToLinear(srgb) * gain))
}

export type SkinToneStep = {
  /** 1-N. Stable identifier — safe for analytics or copy. */
  step: number
  label: string
  /**
   * The reference hex. This is what gets PERSISTED to profiles.selected_skin_tone — storing a hex
   * rather than the scalar keeps the column's existing meaning, so no migration is needed and a
   * value saved under any previous palette still projects to a sensible tone.
   */
  hex: string
  /** Position on the melanin axis. This is what the renderer consumes. */
  tone: number
}

/** The selectable tones. */
export const SKIN_TONE_STEPS: SkinToneStep[] = SKIN_REFERENCE_CHIPS.map((c) => ({
  step: c.step,
  label: c.label,
  hex: c.hex,
  tone: projectHexToTone(c.hex) as number,
}))

/**
 * Mean skin colour and tone of each mannequin as shot.
 *
 * Measured once from the photographs. Lets a picker swatch be computed by pure arithmetic — apply
 * the same gain the renderer would — instead of decoding a 5.5M-pixel image just to show a chip.
 * Re-measure alongside the head anchors if a mannequin asset is replaced.
 */
export const MANNEQUIN_BASE_SKIN: Record<"male" | "female", { srgb: [number, number, number]; tone: number }> = {
  female: { srgb: [192, 159, 137], tone: 1.944 },
  male: { srgb: [218, 165, 158], tone: 1.537 },
}

/**
 * The colour a picker chip should show for a tone: the mannequin's own skin retoned, NOT the raw
 * reference chip.
 *
 * The chips are flat patches measured under controlled light; the mannequin is lit. Showing the chip
 * directly means the swatch you click looks nothing like the body you get.
 */
export function skinToneChipColor(mannequin: "male" | "female", tone: number): string {
  const base = MANNEQUIN_BASE_SKIN[mannequin]
  const gain = melaninGain(tone - base.tone)
  const [r, g, b] = base.srgb.map((c, i) => retoneChannel(c, gain[i]))
  return `rgb(${r}, ${g}, ${b})`
}

