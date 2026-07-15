import { normalizeHostname } from './shared';
import { isMyntra, extractMyntraImages, getMyntraStyleId } from './myntra';
import { isOffduty, extractOffdutyImages } from './offduty';
import { isMango, extractMangoImages } from './mango';
import { isNykaa, extractNykaaImages } from './nykaa';
import { isPuma, extractPumaImages } from './puma';
import { isNishorama, extractNishoramaImages } from './nishorama';
import { isBonkerscorner, extractBonkerscornerImages } from './bonkerscorner';

export interface PostProcessParams {
  originalUrl: string;
  finalUrl: string;
  html?: string;
  jsonImages: string[];
}

export interface SiteProfile {
  id: string;
  needsHtml: boolean;
  needsRawHtml?: boolean;
  transformUrl?: (url: string) => string;
  buildScrapePrompt?: (originalUrl: string) => string;
  extraActions?: Record<string, unknown>[];
  postProcess(params: PostProcessParams): string[];
}

function hostnameFromUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

const PROFILES: Array<{
  match(hostname: string): boolean;
  profile: SiteProfile;
}> = [
  {
    match: isMyntra,
    profile: {
      id: 'myntra',
      needsHtml: true,
      needsRawHtml: true,
      buildScrapePrompt(originalUrl) {
        const styleId = getMyntraStyleId(originalUrl);
        const styleLine = styleId ? `Myntra style_id for THIS PDP: ${styleId}` : 'Myntra style_id for THIS PDP: (unknown)';
        return `MYNTRA OVERRIDE (images only):\n${styleLine}\n\nThe primary product gallery images are stored as CSS background-image URLs on the main image grid.\nExtract gallery images ONLY from elements like:\n- div.image-grid-image (style="background-image: url(...)")\n- within containers such as image-grid-imageContainer / image-grid-container / pdp-details.\n\nEXCLUDE images from:\n- "More Colors" / color variants section\n- cross-sell / recommendations / similar products\n- header/footer icons, logos, sprites, ads.\n\nCRITICAL FILTER:\n- If the style_id is known (above) and the URL contains an explicit numeric /assets/images/<id>/ segment, only keep URLs where <id> matches this style_id.\n\nQUALITY:\n- Prefer higher-resolution assets (e.g., h_720,q_90 or larger) when multiple variants exist.`;
      },
      extraActions: [
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
      ],
      postProcess({ originalUrl, html, jsonImages }) {
        return extractMyntraImages(html ?? '', originalUrl, jsonImages);
      },
    },
  },
  {
    match: isOffduty,
    profile: {
      id: 'offduty',
      needsHtml: true,
      buildScrapePrompt(originalUrl) {
        return `OFFDUTY (Shopify) OVERRIDE (images):\nProduct URL: ${originalUrl}\n\nThe primary product gallery is rendered as a list of thumbnail items, typically:\n- div.product__thumb-item (within a product__thumbs container)\n- each thumb often has <a href="..._1800x1800.jpg"> and/or an <img> with (data-)srcset.\n\nIMAGES REQUIREMENTS (critical):\n- Extract ALL product gallery images from the thumb list in natural order.\n- Prefer the highest-resolution variant (e.g. _1800x1800) when multiple sizes exist.\n- EXCLUDE videos (mp4/webm), customer reviews, payment icons, logos, recommendations.`;
      },
      extraActions: [
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
      ],
      postProcess({ originalUrl, html, jsonImages }) {
        return extractOffdutyImages(html ?? '', originalUrl, jsonImages);
      },
    },
  },
  {
    match: isMango,
    profile: {
      id: 'mango',
      needsHtml: true,
      buildScrapePrompt(originalUrl) {
        return `MANGO OVERRIDE (images only):\nProduct URL: ${originalUrl}\n\nThe primary product gallery is rendered inside slider/carousel containers (e.g., class selector carousel-container, product-images, or similar layout).\nExtract gallery images ONLY from these main view grids.\n\nEXCLUDE:\n- "Shop the look" / recommendations / complete outfit suggestions.\n- Small color swatch thumbnails (e.g., img.color-swatch).\n- Ads, icons, logos, and UI elements.`;
      },
      extraActions: [
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
      ],
      postProcess({ originalUrl, html, jsonImages }) {
        return extractMangoImages(html ?? '', originalUrl, jsonImages);
      },
    },
  },
  {
    match: isNykaa,
    profile: {
      id: 'nykaa',
      needsHtml: true,
      buildScrapePrompt(originalUrl) {
        return `NYKAA FASHION OVERRIDE (images only):\nProduct URL: ${originalUrl}\n\nThe product images are hosted on their CDN (adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/...)\n\nEXTRACT images only from the main gallery carousel (e.g. container slider-container, pdp-gallery).\n\nEXCLUDE:\n- "Complete the look" / recommendations / similar products.\n- Review images uploaded by customers.\n- Social media sharing icons and logos.`;
      },
      extraActions: [
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
      ],
      postProcess({ originalUrl, html, jsonImages }) {
        return extractNykaaImages(html ?? '', originalUrl, jsonImages);
      },
    },
  },
  {
    match: isPuma,
    profile: {
      id: 'puma',
      needsHtml: true,
      buildScrapePrompt(originalUrl) {
        return `PUMA OVERRIDE (images only):\nProduct URL: ${originalUrl}\n\nPuma gallery images are usually high-resolution pictures loaded via a gallery layout.\n\nEXTRACT:\n- Only the main gallery view images (e.g. from the product details / media showcase area).\n\nEXCLUDE:\n- Recommended products / matching outfits / cross-sell carousel.\n- Search icons, cart icons, brand logos.`;
      },
      extraActions: [
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
      ],
      postProcess({ originalUrl, html, jsonImages }) {
        return extractPumaImages(html ?? '', originalUrl, jsonImages);
      },
    },
  },
  {
    match: isNishorama,
    profile: {
      id: 'nishorama',
      needsHtml: true,
      transformUrl(url) {
        try {
          const parsed = new URL(url);
          if (parsed.hostname === 'row.nishorama.com') {
            parsed.hostname = 'nishorama.com';
          }
          return parsed.toString();
        } catch {
          return url;
        }
      },
      buildScrapePrompt(originalUrl) {
        return `NISHORAMA OVERRIDE (images only):\nProduct URL: ${originalUrl}\n\nEXTRACT:\n- Main product showcase gallery images.\n\nEXCLUDE:\n- Recently viewed / recommendations / "You may also like" blocks.`;
      },
      extraActions: [
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
      ],
      postProcess({ originalUrl, html, jsonImages }) {
        return extractNishoramaImages(html ?? '', originalUrl, jsonImages);
      },
    },
  },
  {
    match: isBonkerscorner,
    profile: {
      id: 'bonkerscorner',
      needsHtml: true,
      buildScrapePrompt(originalUrl) {
        return `BONKERSCORNER OVERRIDE (images only):\nProduct URL: ${originalUrl}\n\nEXTRACT:\n- Main product detail slideshow images.\n\nEXCLUDE:\n- Customers also bought / recommendations / related links.`;
      },
      extraActions: [
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1200 },
      ],
      postProcess({ originalUrl, html, jsonImages }) {
        return extractBonkerscornerImages(html ?? '', originalUrl, jsonImages);
      },
    },
  },
];

export function selectProfile(url: string): SiteProfile | null {
  const hostname = normalizeHostname(hostnameFromUrl(url));
  for (const { match, profile } of PROFILES) {
    if (match(hostname)) return profile;
  }
  return null;
}
