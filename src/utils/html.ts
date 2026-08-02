/**
 * Flatten scraped HTML into readable plain text.
 *
 * Product descriptions come from brand sites, so many carry full markup —
 * nested divs, size-chart tables, inline links. `studioService` already prefers
 * the cleaned `description_text` column, but that is null for anything the
 * enrichment pass hasn't reached, and the raw `description` then renders as
 * literal `<div class="product-details-container">…` on the product page.
 *
 * Deliberately NOT dangerouslySetInnerHTML: this is third-party scraped content,
 * so injecting it would be an XSS hole. DOMParser builds a detached document —
 * scripts in it never execute because it is never attached to the live one.
 */
const BLOCK_LEVEL = "br, p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article"

/**
 * Spaces, tabs and U+00A0 — the non-breaking space behind `&nbsp;`. That one is
 * everywhere in scraped markup and survives textContent, so it has to collapse
 * alongside the ordinary ones or the text keeps its original ragged spacing.
 * Expressed as "whitespace minus newlines" so no invisible characters end up
 * in this file, and so it also catches the thin/hair spaces scrapers drag in.
 */
const HORIZONTAL_WHITESPACE = /[^\S\r\n]+/g

export function htmlToPlainText(input: string | null | undefined): string {
  if (!input) return ""

  // Cheap exit for text that was never markup.
  if (!input.includes("<") && !input.includes("&")) return input.trim()

  if (typeof DOMParser === "undefined") {
    // Non-browser context (tests, tooling): fall back to a tag strip.
    return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  }

  const doc = new DOMParser().parseFromString(input, "text/html")
  doc.querySelectorAll("script, style, noscript").forEach((node) => node.remove())
  // Without a boundary, block elements run their text together: "coldwaterAVOID"
  doc.querySelectorAll(BLOCK_LEVEL).forEach((node) => node.append("\n"))

  return (doc.body.textContent ?? "")
    .replace(HORIZONTAL_WHITESPACE, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
}
