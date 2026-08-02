/**
 * Cut the white studio background off public/mannequins/male.png, so it matches female.png.
 *
 *   bun run scripts/cut-mannequin-background.ts             # dry run: proofs into .hair-bake/, no write
 *   bun run scripts/cut-mannequin-background.ts --publish   # + overwrite public/mannequins/male.png
 *   bun run scripts/cut-mannequin-background.ts --verify    # re-run the assertions on the published file
 *   bun run scripts/cut-mannequin-background.ts --gender female --verify
 *
 * female.png shipped as a proper cutout; male.png shipped as a fully opaque photograph on white, so
 * the Pixi stage (backgroundAlpha: 0) composites a white rectangle onto the page. Most visible in the
 * profile head avatar, where the male head fills its rounded-full disc with a white square.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * THE ONE HARD RULE, and why this script is exempt from it.
 *
 * bake-hair-cutouts.ts states that nothing may write to public/mannequins/{male,female}.png, because
 * every transform in products.placement was calibrated against those exact pixels and a nudged figure
 * corrupts them all silently, with no error and no easy detection. That rule is about GEOMETRY.
 *
 * This script writes only the alpha channel, plus a white-unmatting correction confined to the <=3px
 * band where alpha is neither 0 nor 255. No figure pixel moves. V2/V3 below prove it: RGB must be
 * byte-identical to the source wherever alpha is 0 or 255 — 5,521,653 of 5,529,600 px, 99.86% — and
 * --publish refuses to write if any assertion fails.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Working files and proofs land in the gitignored .hair-bake/mannequin-cut/. The first --publish also
 * stashes the pristine original there as male-source.png, which is what --verify diffs against later.
 */
import sharp from 'sharp'
import { join } from 'node:path'
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'

const CANVAS_W = 1800
const CANVAS_H = 3072

// The flood fill admits anything at or above this luma. Measured background floor is 250, and the
// result is insensitive across 235-248, so this sits comfortably in the gap.
const BG_LUMA = 244

// Foreground components smaller than this are scanner grit, not anatomy. Measured: one component of
// ~1.48M px, then 75 strays totalling 239 px, largest 38.
const SPECK_MIN = 200

// A leak detector, not a precise gate: anything under this means the fill escaped through the figure
// and ate part of the body. The figure measures 1,481,225 px.
const FIGURE_MIN_PX = 1.4e6

// How far the soft alpha ramp reaches in from the flood boundary. Deliberately tiny: it exists to
// recover the JPEG-soft silhouette edge, and must never be wide enough to reach an interior highlight.
const BAND_PX = 3
const RAMP_HI = BG_LUMA // meets the fill continuously: alpha 0 at the threshold the fill stopped at
const RAMP_LO = 232 // fully opaque by here


// A pure-black scanner artifact on the very last row. Asserted before it is cleared, so a re-shot
// asset fails here instead of silently losing a real scanline.
const BLACK_ROW = CANVAS_H - 1

// The figure's silhouette, measured. V7 asserts nothing opaque escapes it.
const FIGURE_BOX = { x0: 76, x1: 1785, y0: 163, y1: 3070 }

// Fraction of the frame the fill should claim. A miss either way means the fill leaked or stalled.
const BG_FRACTION = 0.7321
const BG_FRACTION_TOL = 0.005

// Hard cap on how many pixels may have their RGB rewritten by unmatting. Measured ~7.8k, i.e. a band
// roughly one pixel wide along a silhouette some 8k px around.
const RGB_CHANGE_CAP = 12000

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

const WORK_DIR = join(process.cwd(), '.hair-bake', 'mannequin-cut')
const assetPath = (gender: string) => join(process.cwd(), 'public', 'mannequins', `${gender}.png`)
const sourceStashPath = (gender: string) => join(WORK_DIR, `${gender}-source.png`)

type Raw = { data: Buffer; w: number; h: number }

async function loadRaw(path: string): Promise<Raw> {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== CANVAS_W || info.height !== CANVAS_H) {
    throw new Error(`${path} is ${info.width}x${info.height}, expected ${CANVAS_W}x${CANVAS_H}`)
  }
  if (info.channels !== 4) throw new Error(`${path} decoded to ${info.channels} channels, expected 4`)
  return { data, w: info.width, h: info.height }
}

async function exists(path: string) {
  try { await access(path); return true } catch { return false }
}

/**
 * The pristine, uncut original. Once --publish has run, public/mannequins/male.png is the OUTPUT, so
 * the stash in .hair-bake/ is the only thing left that V2/V3 can diff against.
 */
async function loadSource(gender: string): Promise<{ raw: Raw; from: string }> {
  const stash = sourceStashPath(gender)
  if (await exists(stash)) return { raw: await loadRaw(stash), from: stash }
  return { raw: await loadRaw(assetPath(gender)), from: assetPath(gender) }
}

function lumaPlane({ data }: Raw, n: number): Float32Array {
  const out = new Float32Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) out[p] = luma(data[i], data[i + 1], data[i + 2])
  return out
}

/**
 * 4-connected fill from the frame border, admitting luma >= BG_LUMA.
 *
 * Border connectivity rather than a global threshold, so that a bright region enclosed by the figure
 * is never cleared just for being bright. `forcedRow` is admitted regardless of luma: the black
 * artifact row is background, and until it is cleared it walls off the entire bottom edge, leaving
 * the gap between the legs unreachable and opaque.
 *
 * Explicit stack, never recursion — 5.5M pixels.
 */
function floodBackground(lum: Float32Array, w: number, h: number, forcedRow: number): Uint8Array {
  const n = w * h
  const bg = new Uint8Array(n)
  const stack = new Int32Array(n)
  let top = 0
  const push = (p: number) => { if (!bg[p] && lum[p] >= BG_LUMA) { bg[p] = 1; stack[top++] = p } }

  for (let x = 0; x < w; x++) { const p = forcedRow * w + x; bg[p] = 1; stack[top++] = p }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }

  while (top > 0) {
    const p = stack[--top]
    const x = p % w
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (p >= w) push(p - w)
    if (p < n - w) push(p + w)
  }
  return bg
}

/** Drop foreground components under SPECK_MIN into the background. Returns the surviving sizes, desc. */
function removeSpecks(bg: Uint8Array, w: number, h: number): number[] {
  const n = w * h
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  const kept: number[] = []
  const dropped: number[] = []

  for (let start = 0; start < n; start++) {
    if (bg[start] || seen[start]) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      if (x > 0 && !bg[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; queue[tail++] = p - 1 }
      if (x < w - 1 && !bg[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; queue[tail++] = p + 1 }
      if (p >= w && !bg[p - w] && !seen[p - w]) { seen[p - w] = 1; queue[tail++] = p - w }
      if (p < n - w && !bg[p + w] && !seen[p + w]) { seen[p + w] = 1; queue[tail++] = p + w }
    }
    if (tail < SPECK_MIN) {
      for (let i = 0; i < tail; i++) bg[queue[i]] = 1
      dropped.push(tail)
    } else {
      kept.push(tail)
    }
  }

  kept.sort((a, b) => b - a)
  const droppedPx = dropped.reduce((s, v) => s + v, 0)
  console.log(`  components: kept ${kept.length} [${kept.slice(0, 5).join(', ')}], ` +
    `dropped ${dropped.length} specks totalling ${droppedPx} px`)
  if (!kept.length || kept[0] < FIGURE_MIN_PX) {
    throw new Error(`largest foreground component is ${kept[0] ?? 0} px — the fill leaked through the figure`)
  }
  return kept
}

/**
 * Steps from each foreground pixel to the nearest background pixel, capped at BAND_PX. 0 means
 * background; UNREACHED means interior, further than the cap.
 *
 * `noSeedRow` is background but does not seed, and that exclusion is load-bearing. The figure's feet
 * are cropped by the frame, so the soles at y=3070 are a genuine hard edge; let the cleared artifact
 * row beneath them seed the band and it feathers a visible hairline straight across both soles.
 */
const UNREACHED = 255
function bandDistance(bg: Uint8Array, w: number, h: number, noSeedRow: number): Uint8Array {
  const n = w * h
  const dist = new Uint8Array(n).fill(UNREACHED)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0

  for (let p = 0; p < n; p++) {
    if (!bg[p]) continue
    dist[p] = 0
    if (Math.floor(p / w) === noSeedRow) continue
    const x = p % w
    const touchesFg =
      (x > 0 && !bg[p - 1]) || (x < w - 1 && !bg[p + 1]) ||
      (p >= w && !bg[p - w]) || (p < n - w && !bg[p + w])
    if (touchesFg) queue[tail++] = p
  }

  while (head < tail) {
    const p = queue[head++]
    const d = dist[p]
    if (d >= BAND_PX) continue
    const x = p % w
    const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1]
    for (const q of nb) {
      if (q < 0 || bg[q] || dist[q] !== UNREACHED) continue
      dist[q] = d + 1
      queue[tail++] = q
    }
  }
  return dist
}

/** Build the cut RGBA. RGB is copied byte-for-byte except inside the unmatting band. */
function cut(src: Raw): { out: Buffer; bg: Uint8Array } {
  const { data, w, h } = src
  const n = w * h

  // Assert-then-act on the artifact row, before the fill relies on it being clear. A re-shot asset
  // fails here instead of silently losing a real scanline.
  for (let x = 0; x < w; x++) {
    const i = (BLACK_ROW * w + x) * 4
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
      throw new Error(`row ${BLACK_ROW} col ${x} is (${data[i]},${data[i + 1]},${data[i + 2]}), not the ` +
        `pure-black artifact this script clears — the asset changed, re-measure before trusting this run`)
    }
  }

  const lum = lumaPlane(src, n)
  const bg = floodBackground(lum, w, h, BLACK_ROW)
  let bgCount = 0
  for (let p = 0; p < n; p++) if (bg[p]) bgCount++
  console.log(`  flood fill @ luma >= ${BG_LUMA}: ${bgCount} px (${(100 * bgCount / n).toFixed(2)}%)`)

  removeSpecks(bg, w, h)
  const dist = bandDistance(bg, w, h, BLACK_ROW)

  const out = Buffer.from(data)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (bg[p]) { out[i + 3] = 0; continue }
    const d = dist[p]
    if (d === UNREACHED || d > BAND_PX) { out[i + 3] = 255; continue }
    // Photometric coverage against a white matte, not a geometric feather: a genuinely half-covered
    // edge pixel gets its real coverage rather than a fixed falloff.
    const t = (RAMP_HI - lum[p]) / (RAMP_HI - RAMP_LO)
    const ramp = t < 0 ? 0 : t > 1 ? 1 : t
    // ...but the matte must at least explain the darkening we can see. A pixel whose darkest channel
    // sits at `dark` cannot have been shot on white with less coverage than (255-dark)/255. Take the
    // floor and the unmatting below is exactly invertible; skip it and dark edge pixels unmat to a
    // negative colour, clamp at 0, and re-matte lighter than they were shot — a white fringe.
    const dark = Math.min(data[i], data[i + 1], data[i + 2])
    out[i + 3] = Math.round(255 * Math.max(ramp, (255 - dark) / 255))
  }

  // Undo the white matte on the soft band, so the figure does not fringe white on a dark surface.
  // The alpha floor above guarantees the numerator stays non-negative, so nothing clamps.
  let unmatted = 0
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = out[i + 3]
    if (a === 0 || a === 255) continue
    const A = a / 255
    for (let c = 0; c < 3; c++) out[i + c] = clamp255(Math.round((data[i + c] - (1 - A) * 255) / A))
    unmatted++
  }
  console.log(`  unmatted ${unmatted} band px`)

  return { out, bg }
}

type Check = { id: string; what: string; detail: string; ok: boolean }

function verify(src: Raw | null, out: Raw): Check[] {
  const { data, w, h } = out
  const n = w * h
  const checks: Check[] = []
  const add = (id: string, what: string, ok: boolean, detail: string) =>
    checks.push({ id, what, ok, detail })

  add('V1', 'dimensions and channels', true, `${w}x${h}x4`)

  let a0 = 0
  let a255 = 0
  let partial = 0
  let minX = w, maxX = -1, minY = h, maxY = -1
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = data[i + 3]
    if (a === 0) { a0++; continue }
    if (a === 255) a255++; else partial++
    const x = p % w
    const y = (p - x) / w
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  if (src) {
    let diffOpaque = 0
    let diffClear = 0
    let changed = 0
    let maxFlatten = 0
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const a = data[i + 3]
      const same = data[i] === src.data[i] && data[i + 1] === src.data[i + 1] && data[i + 2] === src.data[i + 2]
      if (!same) changed++
      if (a === 255 && !same) diffOpaque++
      if (a === 0 && !same) diffClear++
      if (a > 0) {
        // Re-matte the output over white and compare to the source, which was shot on white.
        const A = a / 255
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(data[i + c] * A + 255 * (1 - A) - src.data[i + c])
          if (d > maxFlatten) maxFlatten = d
        }
      }
    }
    add('V2', 'RGB identical where alpha == 255', diffOpaque === 0, `${a255} px checked, ${diffOpaque} diffs`)
    add('V3', 'RGB identical where alpha == 0', diffClear === 0, `${a0} px checked, ${diffClear} diffs`)
    add('V4', `RGB rewrites <= ${RGB_CHANGE_CAP}`, changed <= RGB_CHANGE_CAP, `${changed} px`)
    add('V8', 'output over white matches source', maxFlatten <= 2, `max delta ${maxFlatten.toFixed(2)}/255`)
  } else {
    for (const id of ['V2', 'V3', 'V4', 'V8']) {
      add(id, 'needs the pristine source', true, 'SKIPPED — no .hair-bake/ source stash')
    }
  }

  const frac = a0 / n
  add('V5', 'transparent fraction', Math.abs(frac - BG_FRACTION) <= BG_FRACTION_TOL,
    `${a0} px (${(100 * frac).toFixed(2)}%), expected ${(100 * BG_FRACTION).toFixed(2)}% +/- ${100 * BG_FRACTION_TOL}%`)

  let blackRowClear = 0
  for (let x = 0; x < w; x++) if (out.data[(BLACK_ROW * w + x) * 4 + 3] === 0) blackRowClear++
  add('V6', `row ${BLACK_ROW} fully transparent`, blackRowClear === w, `${blackRowClear}/${w}`)

  const inBox = minX >= FIGURE_BOX.x0 && maxX <= FIGURE_BOX.x1 && minY >= FIGURE_BOX.y0 && maxY <= FIGURE_BOX.y1
  add('V7', 'opaque pixels stay inside the figure box', inBox,
    `x ${minX}-${maxX}, y ${minY}-${maxY} vs x ${FIGURE_BOX.x0}-${FIGURE_BOX.x1}, y ${FIGURE_BOX.y0}-${FIGURE_BOX.y1}`)

  console.log(`  alpha: ${a0} clear, ${partial} partial, ${a255} opaque`)
  return checks
}

/**
 * Report — never fix — enclosed white regions. A bright pocket fully surrounded by figure is
 * unreachable from the border, so the fill leaves it opaque; only an eye on the checkerboard proof can
 * say whether it is background the fill could not get to or a highlight that belongs to the body.
 *
 * This is the check that caught the gap between the legs: the artifact row along the bottom edge was
 * walling the fill out of it, and every numeric assertion passed regardless. Currently reports none.
 */
function reportPockets(out: Raw): void {
  const { data, w, h } = out
  const n = w * h
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  const pockets: Array<{ size: number; x: number; y: number }> = []

  const white = (p: number) => {
    const i = p * 4
    return data[i + 3] === 255 && luma(data[i], data[i + 1], data[i + 2]) >= BG_LUMA
  }

  for (let start = 0; start < n; start++) {
    if (seen[start] || !white(start)) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1]
      for (const q of nb) {
        if (q < 0 || seen[q] || !white(q)) continue
        seen[q] = 1
        queue[tail++] = q
      }
    }
    if (tail >= 2000) pockets.push({ size: tail, x: start % w, y: Math.floor(start / w) })
  }

  if (!pockets.length) { console.log('  V9  enclosed white pockets >= 2000 px: none'); return }
  console.log(`  V9  enclosed white pockets >= 2000 px: ${pockets.length} — eyeball these on the checkerboard`)
  for (const p of pockets.sort((a, b) => b.size - a.size).slice(0, 10)) {
    console.log(`        ${p.size} px near (${p.x}, ${p.y})`)
  }
}

const PROOF_W = 700
const CHECKER = 80

async function writeProofs(gender: string, src: Raw, outPng: Buffer, outRaw: Raw) {
  await mkdir(WORK_DIR, { recursive: true })
  const proofH = Math.round((CANVAS_H * PROOF_W) / CANVAS_W)

  await writeFile(join(WORK_DIR, `${gender}.png`), outPng)

  const alpha = Buffer.alloc(CANVAS_W * CANVAS_H)
  for (let p = 0; p < CANVAS_W * CANVAS_H; p++) alpha[p] = outRaw.data[p * 4 + 3]
  await sharp(alpha, { raw: { width: CANVAS_W, height: CANVAS_H, channels: 1 } })
    .png().toFile(join(WORK_DIR, `${gender}-alpha.png`))

  const board = Buffer.alloc(PROOF_W * proofH * 3)
  for (let y = 0; y < proofH; y++) {
    for (let x = 0; x < PROOF_W; x++) {
      const v = (Math.floor(x / CHECKER) + Math.floor(y / CHECKER)) % 2 ? 0x66 : 0xaa
      const i = (y * PROOF_W + x) * 3
      board[i] = board[i + 1] = board[i + 2] = v
    }
  }
  const small = await sharp(outPng).resize(PROOF_W).png().toBuffer()
  await sharp(board, { raw: { width: PROOF_W, height: proofH, channels: 3 } })
    .composite([{ input: small }]).png().toFile(join(WORK_DIR, `${gender}-checker.png`))

  // Where RGB was rewritten, painted magenta over the original.
  const band = Buffer.from(src.data)
  for (let p = 0, i = 0; p < CANVAS_W * CANVAS_H; p++, i += 4) {
    const a = outRaw.data[i + 3]
    if (a === 0 || a === 255) continue
    band[i] = 0xff; band[i + 1] = 0x00; band[i + 2] = 0xff; band[i + 3] = 255
  }
  await sharp(band, { raw: { width: CANVAS_W, height: CANVAS_H, channels: 4 } })
    .flatten({ background: '#ffffff' }).resize(PROOF_W).png().toFile(join(WORK_DIR, `${gender}-band.png`))

  console.log(`  proofs: .hair-bake/mannequin-cut/${gender}{,-alpha,-checker,-band}.png`)
}

function report(checks: Check[]): boolean {
  console.log('')
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.id}  ${c.what.padEnd(42)} ${c.detail}`)
  }
  return checks.every((c) => c.ok)
}

async function main() {
  const argv = process.argv.slice(2)
  const publish = argv.includes('--publish')
  const verifyOnly = argv.includes('--verify')
  const gi = argv.indexOf('--gender')
  const gender = gi >= 0 ? argv[gi + 1] : 'male'

  if (gender !== 'male' && gender !== 'female') throw new Error(`unknown gender ${gender}`)

  if (gender === 'female') {
    // female.png shipped already cut. Assert that and stop — this script must never rewrite it.
    const raw = await loadRaw(assetPath('female'))
    let clear = 0
    for (let i = 3; i < raw.data.length; i += 4) if (raw.data[i] === 0) clear++
    console.log(`female.png: ${clear} transparent px`)
    if (clear <= 4_000_000) throw new Error('female.png is not the cutout it is supposed to be')
    console.log('PASS  already a proper cutout, nothing to do')
    return
  }

  if (verifyOnly) {
    const stash = sourceStashPath(gender)
    const src = (await exists(stash)) ? await loadRaw(stash) : null
    if (!src) console.log(`(no ${stash} — V2/V3/V4/V8 need the pristine source and will be skipped)`)
    const out = await loadRaw(assetPath(gender))
    console.log(`verifying ${assetPath(gender)}`)
    reportPockets(out)
    if (!report(verify(src, out))) process.exit(1)
    console.log('\nAll assertions passed.')
    return
  }

  const { raw: src, from } = await loadSource(gender)
  console.log(`source ${from}`)
  for (let i = 3; i < src.data.length; i += 4) {
    if (src.data[i] !== 255) {
      throw new Error('source already carries transparency — it has been cut once already. Restore ' +
        `${assetPath(gender)} from git, or point this at the ${sourceStashPath(gender)} stash.`)
    }
  }

  const { out } = cut(src)
  const outPng = await sharp(out, { raw: { width: CANVAS_W, height: CANVAS_H, channels: 4 } })
    .png({ compressionLevel: 9 }).toBuffer()

  // Round-trip through the encoder, so the assertions run on the bytes that actually ship rather than
  // on the in-memory buffer.
  const outRaw = await loadRaw(await (async () => {
    await mkdir(WORK_DIR, { recursive: true })
    const p = join(WORK_DIR, `${gender}.png`)
    await writeFile(p, outPng)
    return p
  })())

  await writeProofs(gender, src, outPng, outRaw)
  reportPockets(outRaw)
  const ok = report(verify(src, outRaw))

  if (!publish) {
    console.log(`\nDry run. ${ok ? 'All assertions passed' : 'ASSERTIONS FAILED'} — ` +
      're-run with --publish to overwrite public/mannequins/male.png.')
    if (!ok) process.exit(1)
    return
  }

  if (!ok) {
    console.error('\nRefusing to publish: assertions failed.')
    process.exit(1)
  }

  const stash = sourceStashPath(gender)
  if (!(await exists(stash))) {
    await writeFile(stash, await readFile(assetPath(gender)))
    console.log(`  stashed the pristine original at ${stash}`)
  }
  await writeFile(assetPath(gender), outPng)

  // The app serves the .webp; this .png is the master it re-encodes from. Written together or a
  // re-cut would appear to do nothing, since the renderer never reads the PNG. Format-only at
  // identical dimensions — probeMannequinBounds derives the figure box from these pixels and every
  // saved placement is registered against it, so the bounds were verified byte-identical under this
  // encoder setting before the app was pointed at WebP.
  const outWebp = await sharp(outPng).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer()
  await writeFile(assetPath(gender).replace(/\.png$/, '.webp'), outWebp)

  console.log(`\nPublished public/mannequins/${gender}.png (${(outPng.length / 1024 / 1024).toFixed(2)} MiB)`)
  console.log(`      + public/mannequins/${gender}.webp (${(outWebp.length / 1024).toFixed(0)} KiB) — the served asset`)
  console.log('Next: bun run scripts/measure-head-anchor.ts — the male literal must be unchanged.')
}

main().catch((e) => { console.error(e); process.exit(1) })
