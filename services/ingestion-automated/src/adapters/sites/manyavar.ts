import { normalizeHostname, decodeHtmlEntities } from './shared';

/**
 * Manyavar (SAP Commerce / Demandware front end, Scene7 image CDN).
 *
 * Two things defeat the generic filter here, neither of them a scraping failure — the extraction
 * model returns the correct gallery both times:
 *
 *  1. The PDP carousel lazy-loads, so Firecrawl's rendered HTML contains only the first couple of
 *     gallery images. The generic filter intersects the model's images against what it can confirm
 *     in the HTML, so a partial confirmation set prunes the rest of a correct gallery
 *     (UC134696: 6 images -> 3).
 *  2. Scene7 asset names put the distinguishing id AFTER a dot —
 *     `PATIALA67_302-Cream_601.0340_...` vs `...601.0342_...` — and the generic base-asset key
 *     strips everything from the last dot, collapsing genuinely different photographs onto one key
 *     (UC142398: 3 images -> 1).
 *
 * Both are handled by keying on the Scene7 asset identity instead, and by treating every asset that
 * shares the product's stem as part of its gallery.
 */

// .../is/image/manyavar/<STYLE>_<COLOURCODE>-<Colour>_<VIEW>.<ASSETID>_<timestamp>:<W>x<H>
// Marketing and navigation assets (Kids_Mega_Menu_D, MOHEY_WOMEN, New) carry no <VIEW>.<ASSETID>
// pair, which is what separates a product photograph from a banner.
const SCENE7_URL = /https?:\/\/manyavar\.scene7\.com\/is\/image\/manyavar\/[^"'\s\\<>)]+/gi;
const PRODUCT_ASSET = /^(?<stem>.+)_(?<view>\d{3})\.(?<assetId>\d+)(?:_[\d-]+)?(?::(?<width>\d+)x(?<height>\d+))?$/;

export function isManyavar(hostname: string): boolean {
  return normalizeHostname(hostname) === 'manyavar.com';
}

interface Scene7Asset {
  url: string;
  stem: string;
  view: string;
  assetId: string;
  width: number;
}

// Scene7 accepts a space as either '+' or '%20'; the same photograph appears both ways on one page.
function canonicalise(url: string): string {
  return url.replace(/%20/g, '+');
}

function parseAsset(rawUrl: string): Scene7Asset | null {
  const url = canonicalise(decodeHtmlEntities(rawUrl.trim()));
  const slash = url.lastIndexOf('/');
  if (slash < 0) return null;
  const name = url.slice(slash + 1);

  const m = PRODUCT_ASSET.exec(name);
  if (!m?.groups) return null;

  return {
    url,
    stem: m.groups['stem']!.toLowerCase(),
    view: m.groups['view']!,
    assetId: m.groups['assetId']!,
    width: m.groups['width'] ? Number(m.groups['width']) : 0,
  };
}

/** The stem shared by the most candidates — the product this page is actually about. */
function dominantStem(assets: Scene7Asset[]): string | null {
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.stem, (counts.get(a.stem) ?? 0) + 1);

  let best: string | null = null;
  let bestCount = 0;
  for (const [stem, count] of counts) {
    if (count > bestCount) { best = stem; bestCount = count; }
  }
  return best;
}

export function extractManyavarImages(html: string, originalUrl: string, jsonImages: string[]): string[] {
  void originalUrl; // the URL's product code (UC134696) never appears in Scene7 asset names

  const fromJson = jsonImages.map(parseAsset).filter((a): a is Scene7Asset => a !== null);
  const fromHtml = (html.match(SCENE7_URL) ?? []).map(parseAsset).filter((a): a is Scene7Asset => a !== null);

  // The model's images identify the product; the HTML supplies gallery views it may have missed.
  // Falling back to the HTML alone keeps this working if extraction returns nothing at all.
  const stem = dominantStem(fromJson.length > 0 ? fromJson : fromHtml);
  if (!stem) return [];

  const candidates = [...fromJson, ...fromHtml].filter((a) => a.stem === stem);

  // view+assetId is the photograph's identity; the same shot recurs at carousel, thumbnail and zoom
  // sizes, so keep the largest. Assets differing only by assetId are DIFFERENT photographs and must
  // both survive — that is the collapse the generic key caused.
  const best = new Map<string, Scene7Asset>();
  for (const asset of candidates) {
    const key = `${asset.view}.${asset.assetId}`;
    const existing = best.get(key);
    if (!existing || asset.width > existing.width) best.set(key, asset);
  }

  return [...best.values()]
    .sort((a, b) => (a.view === b.view ? a.assetId.localeCompare(b.assetId) : a.view.localeCompare(b.view)))
    .map((a) => a.url);
}
