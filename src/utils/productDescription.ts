import { htmlToPlainText } from "@/utils/html"

/**
 * Turn a scraped product description into labelled sections.
 *
 * Brand sites ship these as a whole mini-page: a Description block, then
 * Details, Wash care, Shipping, and one or more size-chart tables — all inside
 * one `description` column. Flattening it to plain text (htmlToPlainText) stops
 * it rendering as markup, but leaves a single unreadable slab where headings and
 * measurements run into the prose.
 *
 * So: split on headings, and drop tables entirely. Size charts are tabular data
 * that reads as noise once linearised ("XXXS 46" 23.5" 24" XXS 48" …"), and the
 * product page already has its own size-guide affordance for that.
 */
export interface DescriptionSection {
  /** Heading text, or null for prose that appeared before any heading. */
  title: string | null
  paragraphs: string[]
}

/** Wrappers brands use for size guidance — removed wholesale, tables and all. */
const SIZE_GUIDE_SELECTORS = [
  "table",
  ".sizechart",
  ".size-chart-wrapper",
  ".size-chart-table",
  ".size-table-wrapper",
  ".size-guide-container",
  ".size-body-container",
  ".guid-container",
  ".chart-container",
].join(", ")

const BLOCK_SELECTOR = "h1, h2, h3, h4, p, li"

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function parseProductDescription(
  input: string | null | undefined,
): DescriptionSection[] {
  if (!input) return []

  if (typeof DOMParser === "undefined") {
    const text = htmlToPlainText(input)
    return text ? [{ title: null, paragraphs: [text] }] : []
  }

  const doc = new DOMParser().parseFromString(input, "text/html")
  doc.querySelectorAll("script, style, noscript").forEach((node) => node.remove())
  doc.querySelectorAll(SIZE_GUIDE_SELECTORS).forEach((node) => node.remove())
  // Brands separate paragraphs with <br><br> inside a single <p>. textContent
  // drops those, welding sentences together as "…cotton lining.Designed in…",
  // so turn them into breaks the splitter below can see.
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"))

  const sections: DescriptionSection[] = []
  let current: DescriptionSection = { title: null, paragraphs: [] }

  const commit = () => {
    if (current.title || current.paragraphs.length) sections.push(current)
  }

  doc.body.querySelectorAll(BLOCK_SELECTOR).forEach((node) => {
    // A <p> nested in an <li> would otherwise be counted twice.
    if (node.parentElement?.closest(BLOCK_SELECTOR)) return

    const raw = node.textContent ?? ""
    if (!tidy(raw)) return

    if (/^H[1-4]$/.test(node.tagName)) {
      commit()
      current = { title: tidy(raw), paragraphs: [] }
      return
    }

    // One <p> can hold several paragraphs once <br> breaks are honoured.
    raw
      .split("\n")
      .map(tidy)
      .filter(Boolean)
      .forEach((line) => {
        // Brands repeat lines across blocks more often than you'd hope.
        if (current.paragraphs[current.paragraphs.length - 1] === line) return
        current.paragraphs.push(line)
      })
  })

  commit()

  // Nothing matched — the description was bare text with no block structure.
  if (sections.length === 0) {
    const text = htmlToPlainText(input)
    return text ? [{ title: null, paragraphs: [text] }] : []
  }

  return sections.filter((section) => section.paragraphs.length > 0)
}
