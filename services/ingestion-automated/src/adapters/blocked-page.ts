/**
 * Detecting an upstream block that arrives dressed as a success.
 *
 * Myntra began serving its anti-bot page to Firecrawl's datacenter IPs around 2026-09-10, and it
 * does so with **HTTP 200** and the title "Site Maintenance". Nothing in the transport could see
 * that: `resp.ok` is true, there is no status to classify, and the adapter handed the page to the
 * LLM extraction step exactly as if it were a PDP.
 *
 * What came back was worse than an error. Asked for a product from a page that has none, the model
 * INVENTED one — `https://www.example.com/assets/images/32796823/detail.jpg`, brand/name/price all
 * null. Those placeholder URLs then failed to download and the job died as "All image downloads
 * failed — cannot proceed", which points at our downloader rather than at the block. 44 jobs died
 * that way with a misleading verdict, and had the placeholders happened to resolve we would have
 * published fabricated products instead.
 *
 * So this is a data-integrity guard first and a diagnostics fix second: a blocked render must fail
 * loudly, as a retryable upstream condition, rather than quietly becoming invented catalogue data.
 *
 * Pure — no config, no network — so the drills can exercise it (see CLAUDE.md).
 */

/** Titles a WAF/anti-bot interstitial serves in place of the real page. */
const BLOCK_TITLE_PATTERNS: readonly RegExp[] = [
  /site maintenance/i,
  /access denied/i,
  /attention required/i,          // Cloudflare
  /just a moment/i,               // Cloudflare interstitial
  /are you a (?:human|robot)/i,
  /pardon our interruption/i,     // PerimeterX
  /request blocked/i,
  /security check/i,
];

/** Body text that means "no product here", however the page is titled. */
const BLOCK_BODY_PATTERNS: readonly RegExp[] = [
  /oops!?\s*something went wrong/i,
  /please contact your administrator/i,
  /enable javascript and cookies to continue/i,
  /unusual traffic from your/i,
];

/**
 * Hosts a model reaches for when it has to invent a URL. None of these can ever be a real product
 * CDN, so an image on one is proof the extraction was hallucinated rather than read.
 */
const PLACEHOLDER_IMAGE_HOSTS: readonly string[] = [
  'example.com',
  'example.org',
  'example.net',
  'placeholder.com',
  'via.placeholder.com',
  'localhost',
];

export function isPlaceholderImageUrl(url: string): boolean {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  const bare = host.startsWith('www.') ? host.slice(4) : host;
  return PLACEHOLDER_IMAGE_HOSTS.includes(bare);
}

export interface BlockedPageInput {
  title?: string;
  /** Any text rendering of the page — markdown, or the cleaned HTML. */
  body?: string;
  /** Image URLs the extraction step produced, before any download is attempted. */
  imageUrls?: readonly string[];
}

/**
 * Why this page cannot be a product page, or null if it looks fine.
 *
 * Length alone is deliberately NOT a signal: a sparse PDP is not a block, and guessing on size
 * would fail live work. Every rule here keys on something only an interstitial says.
 */
export function blockedPageReason(input: BlockedPageInput): string | null {
  const title = (input.title ?? '').trim();
  const body = input.body ?? '';

  for (const re of BLOCK_TITLE_PATTERNS) {
    if (re.test(title)) return `upstream served an anti-bot page titled "${title}"`;
  }
  for (const re of BLOCK_BODY_PATTERNS) {
    if (re.test(body)) return 'upstream served an anti-bot page instead of the product';
  }

  // The tell that survives a block page we do not yet have a pattern for: every image the model
  // produced is on a host that cannot host products. One real image means the page was read.
  const images = input.imageUrls ?? [];
  if (images.length > 0 && images.every(isPlaceholderImageUrl)) {
    return 'extraction returned only placeholder image URLs — the page had no product on it';
  }

  return null;
}
