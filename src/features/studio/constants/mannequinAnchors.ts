/**
 * Head landmarks on the 1800x3072 placement mannequins.
 *
 * Measured by `bun run scripts/measure-head-anchor.ts`. These are pixel coordinates in specific
 * image files: re-run that script whenever a mannequin asset is replaced.
 *
 * Used for framing a head-and-shoulders crop of the figure. (They were also once used to position
 * flat SVG hair silhouettes onto the head, which is no longer how hair works — the baked cutouts
 * carry their own position — so the scaling maths that went with that has been removed.)
 */
/**
 * The placement composition space. Every mannequin and every baked hair cutout
 * is authored at these dimensions, so the anchors below are directly comparable
 * across assets.
 */
export const PLACEMENT_CANVAS_WIDTH = 1800
export const PLACEMENT_CANVAS_HEIGHT = 3072

export type HeadAnchor = {
  /** Figure centre-line x. The mannequins are NOT centred on CANVAS_W/2. */
  cx: number
  /** Crown y — top of the bald skull. */
  top: number
  /** Chin y — the neck pinch. */
  chin: number
  /** Skull width at the cheekbones. */
  width: number
}

export const PLACEMENT_HEAD_ANCHOR: Record<"male" | "female", HeadAnchor> = {
  female: { cx: 896, top: 146, chin: 508, width: 259 },
  // chin moved 548 -> 553 when male.png's background was cut: unmatting the silhouette band darkens
  // those edge pixels, so the neck reads a hair wider and the pinch lands 5px lower. Re-measured, not
  // hand-tuned — see scripts/measure-head-anchor.ts.
  male: { cx: 900, top: 164, chin: 553, width: 278 },
}

/**
 * Head-and-shoulders crop in canvas coordinates.
 *
 * Generous on all sides of the skull: hair rises well above the crown and long styles fall past the
 * shoulders, so a crop tight to the anchor would cut them off.
 */
export function headCropRect(mannequin: "male" | "female") {
  const a = PLACEMENT_HEAD_ANCHOR[mannequin]
  const headH = a.chin - a.top
  const top = Math.max(0, a.top - headH * 0.55)
  const bottom = a.chin + headH * 1.35
  const halfW = a.width * 1.9
  return { x: a.cx - halfW, y: top, w: halfW * 2, h: bottom - top }
}
