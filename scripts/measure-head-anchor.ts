/**
 * Measure the head anchor of each placement mannequin.
 *
 *   bun run scripts/measure-head-anchor.ts
 *
 * The Pixi placement canvas (1800x3072) has no chin and no body height, so the legacy hair math —
 * which is expressed as a percentage of body height measured from the chin — has no origin to work
 * from. This script recovers that origin by measuring the crown, chin and skull width directly off
 * the mannequin PNGs, and prints the literal to paste into
 * src/features/studio/constants/mannequinAnchors.ts.
 *
 * Run it again whenever a mannequin asset is replaced; the numbers are pixel coordinates in that
 * exact image and do not survive a re-render of the asset.
 */
import sharp from 'sharp'
import { join } from 'node:path'

const CANVAS_W = 1800
const CANVAS_H = 3072

// Same figure test probeMannequinBounds uses. The brightness half is what carries male.png, which
// has a WHITE background rather than a transparent one — drop it and the male figure reads as
// full-bleed and every measurement collapses to the image bounds.
const ALPHA_CUTOFF = 12
const BRIGHT_CUTOFF = 245

// Measured over a band wide enough to contain the shoulders (they are the landmark that bounds the
// head search) but not the image edges, where male.png carries faint compression artifacts.
const BAND_LO = 0.15
const BAND_HI = 0.85
// Per row we take the LONGEST CONTIGUOUS RUN, not the pixel count. The head, neck and torso are each
// one solid blob, so a run tracks the actual silhouette width; a raw count would sum the torso with
// both arms lower down, and would happily count stray artifact pixels as figure.
const MIN_RUN = 20

type RowStat = { run: number; minX: number; maxX: number }

async function rowStats(path: string): Promise<{ rows: RowStat[]; w: number; h: number }> {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .resize(CANVAS_W, CANVAS_H, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width: w, height: h, channels } = info
  const loX = Math.floor(w * BAND_LO)
  const hiX = Math.ceil(w * BAND_HI)
  const rows: RowStat[] = []

  for (let y = 0; y < h; y++) {
    let run = 0
    let runStart = -1
    let best = 0
    let bestStart = -1
    for (let x = loX; x < hiX; x++) {
      const i = (y * w + x) * channels
      const bright = (data[i] + data[i + 1] + data[i + 2]) / 3
      const solid = data[i + 3] > ALPHA_CUTOFF && bright < BRIGHT_CUTOFF
      if (solid) {
        if (run === 0) runStart = x
        run++
        if (run > best) { best = run; bestStart = runStart }
      } else {
        run = 0
      }
    }
    rows.push({ run: best, minX: bestStart, maxX: bestStart + best - 1 })
  }
  return { rows, w, h }
}

/** Figure bottom — the last row with any figure pixel, scanning the full width. */
async function figureBottom(path: string): Promise<number> {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .resize(CANVAS_W, CANVAS_H, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels } = info
  for (let y = h - 1; y >= 0; y--) {
    let count = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels
      const bright = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (data[i + 3] > ALPHA_CUTOFF && bright < BRIGHT_CUTOFF) count++
    }
    if (count > w * 0.02) return y
  }
  return h - 1
}

function measure(rows: RowStat[]) {
  const centreLo = CANVAS_W * 0.35
  const centreHi = CANVAS_W * 0.65

  // Crown: first row with a real run whose midpoint is central. The centrality test is what rejects
  // male.png's edge artifacts — they are never centred on the figure.
  let crown = -1
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y]
    if (r.run < MIN_RUN) continue
    const mid = (r.minX + r.maxX) / 2
    if (mid < centreLo || mid > centreHi) continue
    crown = y
    break
  }
  if (crown < 0) throw new Error('no figure found')

  // Shoulder line: the steepest widening anywhere below the crown. On a standing figure nothing else
  // comes close — the head-to-neck transition is a narrowing, and the torso below the shoulders is
  // near-constant. This bounds the head search without any magic pixel windows.
  const GRAD = 15
  let shoulderY = -1
  let bestGrad = 0
  const scanEnd = Math.min(rows.length - GRAD - 1, crown + Math.round(CANVAS_H * 0.45))
  for (let y = crown; y < scanEnd; y++) {
    const g = rows[y + GRAD].run - rows[y].run
    if (g > bestGrad) { bestGrad = g; shoulderY = y }
  }
  if (shoulderY < 0) throw new Error('no shoulder line found')

  // Widest point of the skull. Taking a plain max over [crown, shoulderY) does not work: the
  // shoulder ramp starts rising before the gradient window flags it, so the max lands on the ramp
  // rather than on the cheekbones. Instead take the FIRST sustained decline — the skull widens
  // monotonically from the crown, then narrows toward the jaw, and that turning point is the widest
  // the head ever gets.
  const DECLINE = 20
  let headMaxRow = -1
  for (let y = crown; y + DECLINE * 2 < shoulderY; y++) {
    const r = rows[y].run
    if (r < MIN_RUN * 3) continue
    if (r >= rows[y + DECLINE].run && r >= rows[y + DECLINE * 2].run) { headMaxRow = y; break }
  }
  if (headMaxRow < 0) throw new Error('no skull peak found')
  const headMax = rows[headMaxRow].run

  // Chin/neck: the narrowest row between the cheekbones and the shoulders.
  let chin = headMaxRow
  let chinWidth = Number.POSITIVE_INFINITY
  for (let y = headMaxRow + 1; y < shoulderY; y++) {
    const c = rows[y].run
    if (c >= MIN_RUN && c < chinWidth) { chinWidth = c; chin = y }
  }
  if (!Number.isFinite(chinWidth)) { chin = shoulderY; chinWidth = rows[shoulderY].run }

  // Centre line: average the skull's midpoint across the head rows, steadier than any single row
  // (the crown row is only a few pixels wide).
  let sum = 0
  let n = 0
  for (let y = crown; y <= headMaxRow; y++) {
    if (rows[y].run < MIN_RUN) continue
    sum += (rows[y].minX + rows[y].maxX) / 2
    n++
  }
  const cx = n ? Math.round(sum / n) : Math.round(CANVAS_W / 2)

  return { cx, top: crown, chin, width: headMax, chinWidth, headMaxRow, shoulderY }
}

async function main() {
  const out: Record<string, { cx: number; top: number; chin: number; width: number }> = {}

  for (const gender of ['female', 'male'] as const) {
    const path = join(process.cwd(), 'public', 'mannequins', `${gender}.png`)
    const { rows } = await rowStats(path)
    const m = measure(rows)
    const bottom = await figureBottom(path)

    out[gender] = { cx: m.cx, top: m.top, chin: m.chin, width: m.width }

    console.log(`\n=== ${gender} ===`)
    console.log(`  crown        y=${m.top}`)
    console.log(`  cheekbones   y=${m.headMaxRow}  width=${m.width}px`)
    console.log(`  chin/neck    y=${m.chin}  width=${m.chinWidth}px`)
    console.log(`  shoulders    y=${m.shoulderY}`)
    console.log(`  figure bottom y=${bottom}`)
    console.log(`  head height  ${m.chin - m.top}px   body (chin->feet) ${bottom - m.chin}px`)
    console.log(`  head:body    ${(((m.chin - m.top) / (bottom - m.chin)) * 100).toFixed(1)}%`)
    console.log('  silhouette from crown to shoulders (confirm the chin pick by eye):')
    for (let y = m.top; y <= Math.min(m.shoulderY + 60, rows.length - 1); y += 20) {
      const bar = '#'.repeat(Math.round(rows[y].run / 8))
      const tag = y === m.chin ? '   <-- chin' : ''
      console.log(`    y=${String(y).padStart(4)} w=${String(rows[y].run).padStart(4)} ${bar}${tag}`)
    }
  }

  console.log('\n\n// paste into src/features/studio/constants/mannequinAnchors.ts')
  console.log('export const PLACEMENT_HEAD_ANCHOR: Record<"male" | "female", HeadAnchor> = {')
  for (const g of ['female', 'male'] as const) {
    const a = out[g]
    console.log(`  ${g}: { cx: ${a.cx}, top: ${a.top}, chin: ${a.chin}, width: ${a.width} },`)
  }
  console.log('}')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
