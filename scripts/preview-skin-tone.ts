/**
 * Render the mannequin skin-tone ramp to a contact sheet, offline.
 *
 *   bun run scripts/preview-skin-tone.ts [female|male] [hairStyle]
 *
 * Imports the melanin model directly from src/shared/skin/melanin rather than restating it, so this
 * cannot drift from what the app renders. Only the pixel plumbing differs — sharp here, canvas in
 * the browser.
 *
 * Writes to .hair-bake/ (gitignored).
 */
import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  SKIN_TONE_STEPS,
  melaninGain,
  pixelTone,
  retoneChannel,
} from '../src/shared/skin/melanin'

const W = 1800
const H = 3072

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Body vs background. Both mannequins are transparent-backed; the brightness half is free insurance. */
const isSkin = (d: Buffer, i: number) => d[i + 3] >= 32 && luma(d[i], d[i + 1], d[i + 2]) < 245

/** Mean position of the mannequin's own skin along the axis — the tone it was shot at. */
function mannequinTone(d: Buffer): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (!isSkin(d, i)) continue
    sum += pixelTone(d[i], d[i + 1], d[i + 2])
    n++
  }
  return n ? sum / n : 0
}

function retone(d: Buffer, delta: number): Buffer {
  const out = Buffer.from(d)
  const gain = melaninGain(delta)
  for (let i = 0; i < d.length; i += 4) {
    if (!isSkin(d, i)) continue
    out[i] = retoneChannel(d[i], gain[0])
    out[i + 1] = retoneChannel(d[i + 1], gain[1])
    out[i + 2] = retoneChannel(d[i + 2], gain[2])
  }
  return out
}

async function main() {
  const gender = (process.argv[2] ?? 'female') as 'female' | 'male'
  const hairStyle = process.argv[3] ?? (gender === 'female' ? 'bob' : 'parted')

  const { data } = await sharp(join(process.cwd(), 'public', 'mannequins', `${gender}.png`))
    .ensureAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })

  let hair: Buffer | null = null
  try {
    hair = Buffer.from(
      await Bun.file(join(process.cwd(), 'public', 'hair-baked', gender, `${hairStyle}.png`)).arrayBuffer(),
    )
  } catch {
    console.log(`(no baked hair for ${gender}/${hairStyle} — skin only)`)
  }

  const base = mannequinTone(data as Buffer)
  console.log(`${gender} mannequin sits at tone ${base.toFixed(3)}\n`)

  const tiles: Buffer[] = []
  for (const step of SKIN_TONE_STEPS) {
    const delta = step.tone - base
    const gain = melaninGain(delta)

    let png = await sharp(retone(data as Buffer, delta), { raw: { width: W, height: H, channels: 4 } })
      .flatten({ background: '#ffffff' }).png().toBuffer()
    if (hair) png = await sharp(png).composite([{ input: hair }]).png().toBuffer()
    tiles.push(await sharp(png).extract({ left: 400, top: 0, width: 1000, height: 1700 }).resize(280).png().toBuffer())

    console.log(
      `  ${String(step.step).padStart(2)} ${step.label.padEnd(16)} tone ${step.tone.toFixed(3)}` +
      `  delta ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}  gain [${gain.map((g) => g.toFixed(3)).join(', ')}]`,
    )
  }

  const sheet = await sharp({
    create: { width: 280 * tiles.length, height: 476, channels: 3, background: '#ffffff' },
  }).composite(tiles.map((t, i) => ({ input: t, left: i * 280, top: 0 }))).png().toBuffer()

  await writeFile(join(process.cwd(), '.hair-bake', `skin-${gender}.png`), sheet)
  console.log(`\nWrote .hair-bake/skin-${gender}.png`)
}

main().catch((e) => { console.error(e); process.exit(1) })
