export type MannequinGender = "male" | "female"

const SKIN_TONE_HEXES = new Set(
  [
    "#fddfc6",
    "#fee0c8",
    "#fee0c7",
    "#fee0c6",
    "#fdd8bc",
    "#f9cfae",
    "#fdd0b3",
    "#fbe1ca",
    "#fbe1cb",
    "#fbe2cb",
    "#fbe3cb",
    "#fce2cb",
    "#fce3cb",
    "#fce3cc",
    "#fde1c8",
    "#fde2ca",
    "#fee2ca",
    "#fce6cf",
    "#fce3cd",
    "#fde5ce",
    "#fde9d1",
    "#fee4cd",
    "#fde0c8",
    "#fde0c7",
    "#fde0c6",
    "#fee6ce",
    "#ffe0c6",
    "#ffe7ce",
  ].map((hex) => hex.toLowerCase()),
)

export const DEFAULT_MANNEQUIN_BODY_TYPE = "bodytype1"

export function applySkinToneToSvg(svgMarkup: string, skinToneHex: string) {
  const normalizedTone = normalizeHex(skinToneHex)
  if (!normalizedTone) {
    return svgMarkup
  }

  let updated = svgMarkup
  let didReplace = false

  updated = updated.replace(/fill="([^"]+)"/gi, (match, value) => {
    if (isNonColorFill(value)) {
      return match
    }
    const normalized = normalizeHex(value)
    if (normalized && SKIN_TONE_HEXES.has(normalized)) {
      didReplace = true
      return `fill="${normalizedTone}"`
    }
    return match
  })

  updated = updated.replace(/fill:\s*(#[0-9a-fA-F]{3,6})/gi, (match, value) => {
    const normalized = normalizeHex(value)
    if (normalized && SKIN_TONE_HEXES.has(normalized)) {
      didReplace = true
      return `fill:${normalizedTone}`
    }
    return match
  })

  if (!didReplace) {
    updated = updated.replace(
      /<(path|circle|ellipse|rect|polygon|polyline)\b([^>]*?)\sfill="([^"]+)"([^>]*?)>/i,
      (match, tag, before, value, after) => {
        if (isNonColorFill(value)) {
          return match
        }
        didReplace = true
        return `<${tag}${before} fill="${normalizedTone}"${after}>`
      },
    )
  }

  if (!didReplace) {
    updated = updated.replace(
      /<(path|circle|ellipse|rect|polygon|polyline)\b([^>]*?)\sstyle="([^"]*?)"([^>]*?)>/i,
      (match, tag, before, styleValue, after) => {
        if (!/fill\s*:\s*[^;]+/i.test(styleValue)) {
          return match
        }
        const nextStyle = styleValue.replace(/fill\s*:\s*[^;]+/i, `fill:${normalizedTone}`)
        didReplace = true
        return `<${tag}${before} style="${nextStyle}"${after}>`
      },
    )
  }

  const outlineTone = darkenHex(normalizedTone, 0.7)
  updated = updated.replace(/stroke="([^"]+)"/gi, (match, value) => {
    if (isNonColorFill(value)) {
      return match
    }
    const normalized = normalizeHex(value)
    if (normalized && (SKIN_TONE_HEXES.has(normalized) || normalized === "#000000")) {
      return `stroke="${outlineTone}"`
    }
    return match
  })

  updated = updated.replace(/stroke:\s*(#[0-9a-fA-F]{3,6})/gi, (match, value) => {
    const normalized = normalizeHex(value)
    if (normalized && (SKIN_TONE_HEXES.has(normalized) || normalized === "#000000")) {
      return `stroke:${outlineTone}`
    }
    return match
  })

  return updated
}

export function buildSvgDataUrl(svgMarkup: string) {
  const trimmed = svgMarkup.trim()
  return `data:image/svg+xml;utf8,${encodeURIComponent(trimmed)}`
}

function isNonColorFill(value: string) {
  const normalized = value.trim().toLowerCase()
  return (
    normalized === "none" ||
    normalized === "transparent" ||
    normalized === "currentcolor" ||
    normalized.startsWith("url(")
  )
}

function normalizeHex(value: string) {
  let hex = value.trim().toLowerCase()
  if (!hex.startsWith("#")) {
    hex = `#${hex}`
  }
  if (hex.length === 4) {
    const [r, g, b] = hex.slice(1).split("")
    hex = `#${r}${r}${g}${g}${b}${b}`
  }
  if (!/^#[0-9a-f]{6}$/.test(hex)) {
    return null
  }
  return hex
}

function darkenHex(hex: string, factor: number) {
  const normalized = normalizeHex(hex)
  if (!normalized) {
    return hex
  }
  const r = Math.round(parseInt(normalized.slice(1, 3), 16) * factor)
  const g = Math.round(parseInt(normalized.slice(3, 5), 16) * factor)
  const b = Math.round(parseInt(normalized.slice(5, 7), 16) * factor)
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`
}
