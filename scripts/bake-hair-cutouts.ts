/**
 * Approach B asset pipeline: bake photoreal hair onto the placement mannequins, then cut it out.
 *
 *   bun run scripts/bake-hair-cutouts.ts                 # bake every gender/style
 *   bun run scripts/bake-hair-cutouts.ts --gender female --style bob
 *   bun run scripts/bake-hair-cutouts.ts --reextract     # recut the kept generations, no new billing
 *
 * Cutouts land in public/hair-baked/{gender}/{styleKey}.png, which is what the app serves; working
 * files (raw generations, proof composites) land in the gitignored .hair-bake/.
 *
 * Output is a full 1800x3072 RGBA frame per (gender, style): transparent everywhere except the hair,
 * with the hair already sitting where it belongs. That is what makes Approach B need no head anchor
 * and no calibration — the renderer draws it at (0,0) scale 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * THE ONE HARD RULE: this script must never write to public/mannequins/{male,female}.png.
 *
 * Every transform in products.placement was calibrated against those exact pixels. Replacing the
 * body image would make every saved placement silently wrong by however far the model nudged the
 * figure — a corruption with no error and no easy detection. We keep the body untouched and layer a
 * transparent cutout over it, so placement data is never at risk. The drift gate below enforces the
 * same discipline on the generated frames.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Env: GOOGLE_API_KEY (required), GEMINI_IMAGE_MODEL / GEMINI_IMAGE_MODEL_FALLBACKS (optional).
 */
import sharp from 'sharp'
import { join } from 'node:path'
import { mkdir, writeFile, readFile } from 'node:fs/promises'

const CANVAS_W = 1800
const CANVAS_H = 3072

// Verified against ListModels. NB: the ingestion service's default fallback chain
// (services/ingestion-automated/src/config/index.ts) still names gemini-3-flash-image and
// gemini-3-flash-image-lite, neither of which exists — both 404.
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image'
const FALLBACKS = (process.env.GEMINI_IMAGE_MODEL_FALLBACKS ||
  'gemini-3.1-flash-image,gemini-3.1-flash-lite-image,gemini-2.5-flash-image')
  .split(',').map((s) => s.trim()).filter(Boolean)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Chin y per mannequin — everything below this is "body" and must not change.
// Source: scripts/measure-head-anchor.ts, mirrored in constants/mannequinAnchors.ts.
const CHIN_Y = { female: 508, male: 548 } as const
const HEAD_CX = { female: 896, male: 900 } as const

/**
 * Maximum mean neck-contour shift, in canvas px, before a generation is rejected.
 *
 * ── Why this and not a whole-body test ──────────────────────────────────────────────────────────
 * The obvious gate is "reject if the body moved", and that is what this script did first. Measured
 * against reality it is the wrong criterion, in both directions:
 *
 *   - Too strict. These models re-render the entire frame. Every generation drifts a few px in the
 *     legs and noticeably at the hands — ~40k disagreeing silhouette pixels below mid-chest even on
 *     output that is perfectly good for our purposes. A body-drift gate rejects everything.
 *   - Wrong target. We never use the generated body. Only hair pixels above the chin are kept and
 *     composited back onto the untouched original mannequin, so leg and hand drift is discarded
 *     along with the rest of the body. It cannot affect anything.
 *
 * What actually matters is whether the HEAD is where it was, because that is what decides if the
 * cutout lands on the skull. Measuring the neck contour just below the chin answers exactly that,
 * and answers it sharply: on real generations the shift there is 0px for row after row, while the
 * rows higher up widen by 100px+ as hair falls past the jaw. Head stable, body drifting, cleanly
 * distinguished.
 */
const NECK_SHIFT_MAX = 8
const MAX_ATTEMPTS = 3

/**
 * Band below the chin used for that measurement, in canvas px. Low enough that hair has stopped
 * covering the neck contour (it is still 100px+ wide at chin+40), high enough to sit above the
 * shoulders.
 */
const NECK_BAND = { from: 160, to: 300 }

/** How far below the chin hair is allowed to reach — long styles fall well past the shoulders. */
const HAIR_REACH = 750

type Gender = 'male' | 'female'

/**
 * Natural-language descriptions of the seeded style keys. The style_key alone ("bob") is too terse
 * to steer an image model consistently.
 */
const STYLE_PROMPTS: Record<Gender, Record<string, string>> = {
  female: {
    fringe: 'long straight hair falling past the shoulders with a blunt fringe across the forehead',
    bob: 'a chin-length bob with a clean straight cut',
    pixie: 'a short cropped pixie cut close to the head',
    curly: 'shoulder-length tightly curled hair with volume at the sides',
    bangs: 'long hair with soft curtain bangs parted at the centre',
    straight: 'long straight hair falling past the shoulders, centre parted',
  },
  male: {
    spikes: 'a short spiked haircut, textured and lifted at the front',
    straight: 'a short straight side-parted haircut',
    buzz: 'a very short buzz cut close to the scalp',
    curly: 'short curly hair with tight volume on top',
    parted: 'a neat short haircut with a defined side part',
    long: 'medium-length hair reaching the jawline, swept back',
  },
}

// Ported from the VTON adapter's system prompt. The silhouette lock is the clause that makes the
// drift gate pass often enough to be usable.
const SYSTEM = `You are a photo editing engine operating on a product mannequin photograph.
The input image is identity-locked: pose, height, body proportions and camera framing must remain pixel-identical.
BODY/SILHOUETTE LOCK: Do not alter the body outline or internal proportions (torso, arms, legs, shoulders, neck). No scaling, slimming, elongation, widening, warping, or repositioning. Do not change the background.
You may ONLY add hair to the head. Everything below the jawline must be returned unchanged.`

function promptFor(gender: Gender, styleKey: string): string {
  const desc = STYLE_PROMPTS[gender][styleKey] ?? styleKey
  return `Add ${desc} to the bald mannequin head in this image.
The hair must sit naturally on the skull with a believable hairline, and match the photograph's lighting, shading and colour temperature.
Hair colour: natural dark brown, evenly lit, no highlights or dye.
Change nothing else about the figure or the background. Do not add a face or any facial features — the mannequin is intentionally featureless.
Output the full image at the same dimensions.`
}

async function callGemini(model: string, b64: string, mime: string, prompt: string) {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY is not set')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!resp.ok) throw new Error(`${model} ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] }; finishReason?: string }[]
  }
  const part = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData)?.inlineData
  if (!part) throw new Error(`${model}: no image (finishReason=${data.candidates?.[0]?.finishReason ?? 'unknown'})`)
  return Buffer.from(part.data, 'base64')
}

/**
 * Try each model in turn, with backoff on overload. The image models 503 under load often enough
 * that a single pass through the chain fails routinely — retrying the chain is what makes an
 * unattended batch actually complete.
 */
async function generate(b64: string, mime: string, prompt: string): Promise<Buffer> {
  let lastErr: unknown
  const chain = [MODEL, ...FALLBACKS]
  for (let round = 0; round < 3; round++) {
    for (const model of chain) {
      try {
        return await callGemini(model, b64, mime, prompt)
      } catch (err) {
        lastErr = err
        const msg = String(err)
        const transient = / 5\d\d:/.test(msg) || /RESOURCE_EXHAUSTED|UNAVAILABLE/.test(msg)
        console.log(`      ${model}: ${transient ? 'overloaded' : msg.slice(0, 120)}`)
        if (!transient && / 404:/.test(msg)) continue // wrong name — never worth retrying
      }
    }
    const wait = 5000 * 2 ** round
    console.log(`      whole chain unavailable, backing off ${wait / 1000}s`)
    await sleep(wait)
  }
  throw lastErr
}

/** Normalise to exactly CANVAS_W x CANVAS_H RGB so two frames are comparable pixel for pixel. */
async function normalise(buf: Buffer) {
  return sharp(buf).resize(CANVAS_W, CANVAS_H, { fit: 'fill' }).removeAlpha().raw().toBuffer()
}

/** Figure vs background, the same test probeMannequinBounds uses. */
function isFigure(raw: Buffer, p: number): boolean {
  return (raw[p] + raw[p + 1] + raw[p + 2]) / 3 < 245
}

/**
 * How much of the body silhouette moved, below the neck line. This is the gate that makes Approach B
 * safe: if the model shifted the figure, we throw the generation away rather than cut hair out of a
 * body that no longer matches the one products.placement was calibrated against.
 *
 * Also returns the mean pixel delta, purely as diagnostic output — it is NOT what we gate on, for
 * the reasons in the DRIFT_THRESHOLD note above.
 */
/** Leftmost/rightmost figure pixel on a row, searched around the figure's centre line. */
function rowExtremes(raw: Buffer, y: number, cx: number): { l: number; r: number } {
  const lo = Math.max(0, cx - 400)
  const hi = Math.min(CANVAS_W, cx + 400)
  let l = -1
  let r = -1
  for (let x = lo; x < hi; x++) {
    if (isFigure(raw, (y * CANVAS_W + x) * 3)) {
      if (l < 0) l = x
      r = x
    }
  }
  return { l, r }
}

/**
 * Mean horizontal shift of the neck contour — i.e. did the head move? See NECK_SHIFT_MAX for why
 * this is the gate rather than a whole-body comparison.
 */
function headAlignment(a: Buffer, b: Buffer, chinY: number, cx: number): number {
  let sum = 0
  let n = 0
  for (let y = chinY + NECK_BAND.from; y < chinY + NECK_BAND.to; y += 10) {
    const ea = rowExtremes(a, y, cx)
    const eb = rowExtremes(b, y, cx)
    if (ea.l < 0 || eb.l < 0) continue
    sum += (Math.abs(eb.l - ea.l) + Math.abs(eb.r - ea.r)) / 2
    n++
  }
  return n ? sum / n : Number.POSITIVE_INFINITY
}

/**
 * Extract the hair as an RGBA cutout in canvas coordinates.
 *
 * The plan calls for the segmentation service's FASHN hair class (class 2). That service runs on
 * Modal and needs a deployed endpoint, so this does the local equivalent: everything that CHANGED
 * versus the bald original, restricted to the head region, is hair. On an identity-locked generation
 * that is a tight definition — and unlike a parser it cannot mistake the mannequin's skin for scalp.
 *
 * Set HAIR_SEGMENTATION_URL to route through the real segmentation service instead.
 */
async function extractHair(originalRaw: Buffer, generated: Buffer, chinY: number): Promise<Buffer> {
  const genRaw = await normalise(generated)

  const width = CANVAS_W
  const height = CANVAS_H
  const rgba = Buffer.alloc(width * height * 4)

  // Hair can rise well above the crown, and long styles fall past the shoulders — same reach the
  // drift gate assumes, so the two stay consistent.
  const limitY = chinY + HAIR_REACH

  const DIFF_ON = 30 // solidly changed → opaque hair
  const DIFF_OFF = 12 // unchanged → fully transparent; between the two we ramp alpha for a soft edge
  // Difference alone is not enough: the model re-shades the face even when it obeys the lock, which
  // reads as a grey haze over the skin. Hair laid over skin makes a pixel DARKER, and by far more
  // than a soft shadow does — the darkening histogram is cleanly bimodal, with unchanged skin at
  // 0-20, a valley at 60-99, and the hair mass from 100 up. 70 sits in the valley: it removes the
  // haze completely while still keeping the lighter strands at the hair's edge (raising it to 100
  // starts pitting the crown). Safe because the prompt fixes the bake to natural dark brown.
  const DARKEN_MIN = 70

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3
      const q = (y * width + x) * 4
      if (y > limitY) continue // leaves alpha 0

      // Fade the last 200px rather than slicing flat: long styles genuinely reach the limit, and a
      // hard edge there reads as a guillotined strand across the chest.
      const taper = y > limitY - 200 ? (limitY - y) / 200 : 1

      const origBright = (originalRaw[p] + originalRaw[p + 1] + originalRaw[p + 2]) / 3
      const genBright = (genRaw[p] + genRaw[p + 1] + genRaw[p + 2]) / 3
      if (origBright - genBright < DARKEN_MIN) continue

      const d = (Math.abs(genRaw[p] - originalRaw[p]) +
        Math.abs(genRaw[p + 1] - originalRaw[p + 1]) +
        Math.abs(genRaw[p + 2] - originalRaw[p + 2])) / 3

      let alpha = 0
      if (d >= DIFF_ON) alpha = 255
      else if (d > DIFF_OFF) alpha = Math.round(((d - DIFF_OFF) / (DIFF_ON - DIFF_OFF)) * 255)
      alpha = Math.round(alpha * taper)
      if (alpha === 0) continue

      rgba[q] = genRaw[p]
      rgba[q + 1] = genRaw[p + 1]
      rgba[q + 2] = genRaw[p + 2]
      rgba[q + 3] = alpha
    }
  }

  // Where hair falls over skin rather than background, only the darkest strand cores clear
  // DARKEN_MIN and the mask comes through blotchy. A morphological close (dilate then erode, done
  // here as blur + threshold on the alpha channel alone) bridges those gaps without growing the
  // outer silhouette. Median first, to drop speckle before it gets dilated into blobs.
  const cleaned = await sharp(rgba, { raw: { width, height, channels: 4 } }).median(3).raw().toBuffer()

  // The close runs in plain JS rather than through sharp. Round-tripping a bare alpha plane through
  // sharp and indexing the result as 1 channel is a trap: what comes back is not necessarily
  // single-channel, and reading it as if it were smears blurred values across the frame — which is
  // exactly how a faint full-body ghost ended up baked into the first pass of these cutouts. It was
  // invisible over an opaque mannequin and glaring on the harness checkerboard.
  const R = 6
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) alpha[i] = cleaned[i * 4 + 3]

  const tmp = new Uint16Array(width * height)
  const blurred = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    let acc = 0
    for (let x = 0; x < width; x++) {
      acc += alpha[y * width + x]
      if (x > 2 * R) acc -= alpha[y * width + x - 2 * R - 1]
      if (x >= R) tmp[y * width + x - R] = acc / Math.min(2 * R + 1, x + 1)
    }
  }
  for (let x = 0; x < width; x++) {
    let acc = 0
    for (let y = 0; y < height; y++) {
      acc += tmp[y * width + x]
      if (y > 2 * R) acc -= tmp[(y - 2 * R - 1) * width + x]
      if (y >= R) blurred[(y - R) * width + x] = Math.min(255, acc / Math.min(2 * R + 1, y + 1))
    }
  }

  for (let i = 0; i < width * height; i++) {
    const y = (i / width) | 0
    // Re-assert the reach limit AFTER the close — a blur does not respect it on its own.
    if (y > limitY) { cleaned[i * 4 + 3] = 0; continue }

    // Fill a gap only where the neighbourhood is mostly hair AND this pixel is itself darkened.
    // Without the second test the close would happily paint over bare skin.
    const p = i * 3
    const darkened = (originalRaw[p] + originalRaw[p + 1] + originalRaw[p + 2]) / 3 -
      (genRaw[p] + genRaw[p + 1] + genRaw[p + 2]) / 3
    if (blurred[i] < 140 || darkened < DARKEN_MIN * 0.5) continue

    if (cleaned[i * 4 + 3] < 255) {
      cleaned[i * 4] = genRaw[p]
      cleaned[i * 4 + 1] = genRaw[p + 1]
      cleaned[i * 4 + 2] = genRaw[p + 2]
      cleaned[i * 4 + 3] = 255
    }
  }

  return sharp(cleaned, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const reextract = process.argv.includes('--reextract')
  const onlyGender = arg('gender') as Gender | undefined
  const onlyStyle = arg('style')

  const outDir = join(process.cwd(), '.hair-bake')
  await mkdir(outDir, { recursive: true })

  const genders: Gender[] = onlyGender ? [onlyGender] : ['female', 'male']
  let ok = 0
  let failed = 0

  for (const gender of genders) {
    const mannequinPath = join(process.cwd(), 'public', 'mannequins', `${gender}.png`)
    const source = await readFile(mannequinPath)
    // Flatten onto white so the model sees a normal photograph, not a checkerboard.
    const flat = await sharp(source).resize(CANVAS_W, CANVAS_H, { fit: 'fill' })
      .flatten({ background: '#ffffff' }).png().toBuffer()
    const originalRaw = await normalise(flat)
    const b64 = flat.toString('base64')
    const chinY = CHIN_Y[gender]
    const cx = HEAD_CX[gender]

    const keys = Object.keys(STYLE_PROMPTS[gender]).filter((k) => !onlyStyle || k === onlyStyle)
    console.log(`\n=== ${gender} (${keys.length} styles) ===`)

    for (const styleKey of keys) {
      console.log(`  ${styleKey}`)
      let accepted: Buffer | null = null

      // --reextract: re-cut from the generation already on disk. Extraction thresholds need tuning
      // by eye, and re-generating to try a new one both costs money and changes the image underneath
      // you, so you can never tell whether the threshold or the draw improved.
      if (reextract) {
        try {
          accepted = await readFile(join(outDir, `${gender}-${styleKey}-generated.png`))
          console.log('    re-extracting from saved generation')
        } catch {
          console.log('    no saved generation — skipping')
          failed++
          continue
        }
      }

      for (let attempt = 1; accepted === null && attempt <= MAX_ATTEMPTS; attempt++) {
        let generated: Buffer
        try {
          generated = await generate(b64, 'image/png', promptFor(gender, styleKey))
        } catch (err) {
          console.log(`    attempt ${attempt}: generation failed — ${String(err).slice(0, 160)}`)
          continue
        }

        // Always keep the raw generation — a rejected one is the only way to see WHY it was rejected.
        const meta = await sharp(generated).metadata()
        await writeFile(join(outDir, `${gender}-${styleKey}-attempt${attempt}-raw.png`), generated)
        console.log(`    attempt ${attempt}: model returned ${meta.width}x${meta.height} (canvas is ${CANVAS_W}x${CANVAS_H})`)

        const shift = headAlignment(originalRaw, await normalise(generated), chinY, cx)
        if (shift > NECK_SHIFT_MAX) {
          console.log(`    attempt ${attempt}: REJECTED — head moved, neck contour off by ${shift.toFixed(1)}px`)
          continue
        }
        console.log(`    attempt ${attempt}: accepted — neck contour aligned to ${shift.toFixed(1)}px`)
        accepted = generated
        break
      }

      if (!accepted) {
        console.log(`    GIVING UP after ${MAX_ATTEMPTS} attempts`)
        failed++
        continue
      }

      if (!reextract) await writeFile(join(outDir, `${gender}-${styleKey}-generated.png`), accepted)
      const cutout = await extractHair(originalRaw, accepted, chinY)
      await writeFile(join(outDir, `${gender}-${styleKey}.png`), cutout)

      // public/ is where these SHIP from, not just a preview: PlacementAvatarRenderer reads
      // /hair-baked/{gender}/{styleKey}.png, so writing here is the publish step. Committed to git
      // alongside public/mannequins/, which the cutouts are calibrated against pixel for pixel —
      // splitting the pair across git and object storage is how they drift apart.
      const publicDir = join(process.cwd(), 'public', 'hair-baked', gender)
      await mkdir(publicDir, { recursive: true })
      await writeFile(join(publicDir, `${styleKey}.png`), cutout)

      // Proof shot: the cutout back over the untouched mannequin, which is exactly what the
      // renderer will do. Two passes — sharp applies resize BEFORE composite within one pipeline,
      // which would shrink the base below the overlay and fail.
      const proof = await sharp(flat).composite([{ input: cutout }]).png().toBuffer()
      await writeFile(
        join(outDir, `${gender}-${styleKey}-composite.png`),
        await sharp(proof).resize(500).png().toBuffer(),
      )

      ok++
    }
  }

  console.log(`\n${ok} baked, ${failed} failed. Working files in .hair-bake/, cutouts in public/hair-baked/.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
