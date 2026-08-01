import type { PickTile } from "@/features/profile/components/PickRow"

/**
 * The five taste strokes (canvas 6c, vocabularies from the Kalagriha handoff
 * §6.1). Slugs are the stored values; labels are display copy, lowercase to
 * match the canvas.
 *
 * Tile art: the canvas illustrates each tag with a garment shot, and reuses the
 * same shot across rows where the association fits (tops/14 is both "craft-core"
 * and "kantha"). The mappings the canvas specifies are reproduced exactly; the
 * options it doesn't draw borrow from the same pool. These are stand-ins — real
 * taste photography is a design deliverable, not something to invent here.
 */

const TOP = (n: string) => `/products/tops/${n}.png`
const BOTTOM = (n: string) => `/products/bottoms/${n}.png`

export interface TasteRow {
  id: string
  label: string
  options: PickTile[]
}

export const TASTE_ROWS: TasteRow[] = [
  {
    id: "vibes",
    label: "Vibes",
    options: [
      { id: "indie_fusion", label: "indie fusion", imageUrl: TOP("13") },
      { id: "quiet_festive", label: "quiet festive", imageUrl: TOP("L3") },
      { id: "street_loom", label: "street loom", imageUrl: BOTTOM("L2") },
      { id: "craft_core", label: "craft-core", imageUrl: TOP("14") },
      { id: "heritage_minimal", label: "heritage minimal", imageUrl: TOP("9") },
      { id: "resort", label: "resort", imageUrl: TOP("6") },
    ],
  },
  {
    id: "styles",
    label: "Styles",
    options: [
      { id: "layered", label: "layered", imageUrl: TOP("10") },
      { id: "monochrome", label: "monochrome", imageUrl: TOP("11") },
      { id: "fusion_formal", label: "fusion formal", imageUrl: TOP("5") },
      { id: "off_duty", label: "off-duty", imageUrl: TOP("8") },
      { id: "occasion", label: "occasion", imageUrl: TOP("L3") },
      { id: "workwear", label: "workwear", imageUrl: BOTTOM("17") },
    ],
  },
  {
    id: "fits",
    label: "Fits",
    options: [
      { id: "boxy", label: "boxy", imageUrl: TOP("4") },
      { id: "tailored", label: "tailored", imageUrl: TOP("9") },
      { id: "flowy", label: "flowy", imageUrl: TOP("6") },
      { id: "wide_leg", label: "wide-leg", imageUrl: BOTTOM("16") },
      { id: "fitted", label: "fitted", imageUrl: TOP("12") },
      { id: "oversized", label: "oversized", imageUrl: TOP("13") },
    ],
  },
  {
    id: "feels",
    label: "Feels",
    options: [
      { id: "soft", label: "soft", imageUrl: TOP("7") },
      { id: "crisp", label: "crisp", imageUrl: TOP("12") },
      { id: "structured", label: "structured", imageUrl: BOTTOM("18") },
      { id: "breathable", label: "breathable", imageUrl: BOTTOM("19") },
      { id: "textured", label: "textured", imageUrl: TOP("14") },
      { id: "drapey", label: "drapey", imageUrl: TOP("6") },
    ],
  },
  {
    id: "fabrics",
    label: "Fabrics & craft",
    options: [
      { id: "kala_cotton", label: "kala cotton", imageUrl: BOTTOM("17") },
      { id: "kantha", label: "kantha", imageUrl: TOP("14") },
      { id: "ikat", label: "ikat", imageUrl: TOP("11") },
      { id: "block_print", label: "block print", imageUrl: BOTTOM("20") },
      { id: "khadi", label: "khadi", imageUrl: TOP("7") },
      { id: "ajrakh", label: "ajrakh", imageUrl: BOTTOM("L2") },
      { id: "handloom_silk", label: "handloom silk", imageUrl: TOP("L3") },
    ],
  },
]
