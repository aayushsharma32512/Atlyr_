import type { SiteContext, SiteProfile } from './types';
import { applyMyntraDeterministicImageFilter, isMyntraHostname, myntraOverridePrompt, myntraStyleIdFromUrl } from './myntra';
import { applyOffdutyDeterministicImageFilter, isOffdutyHostname, offdutyOverridePrompt } from './offduty';
import { applyMangoDeterministicImageFilter, isMangoHostname, mangoOverridePrompt } from './mango';
import { applyNykaaDeterministicImageFilter, isNykaaHostname, nykaaOverridePrompt, nykaaProductIdFromUrl } from './nykaa';
import { applyPumaDeterministicImageFilter, isPumaHostname, pumaOverridePrompt, pumaProductIdFromUrl } from './puma';
import { applyNishoramaDeterministicImageFilter, isNishoramaHostname, nishoramaOverridePrompt, transformNishoramaUrl } from './nishorama';
import { applyBonkersCornerDeterministicImageFilter, isBonkersCornerHostname, bonkersCornerOverridePrompt } from './bonkerscorner';

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeHostname(hostname: string): string {
  const h = (hostname || '').trim().toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

function buildContext(originalUrl: string): SiteContext {
  const hostname = safeHostname(originalUrl);
  const normalizedHostname = normalizeHostname(hostname);
  const ctx: SiteContext = { hostname, normalizedHostname };
  if (normalizedHostname === 'myntra.com') {
    ctx.styleId = myntraStyleIdFromUrl(originalUrl);
  }
  if (normalizedHostname === 'nykaafashion.com') {
    ctx.productId = nykaaProductIdFromUrl(originalUrl);
  }
  if (isPumaHostname(hostname)) {
    ctx.productId = pumaProductIdFromUrl(originalUrl);
  }
  return ctx;
}

const DEFAULT_PROFILE: SiteProfile = {
  id: 'default',
  version: 'v1',
  match: () => true,
  buildScrapePrompt: ({ basePrompt }) => basePrompt,
  scrape: undefined
};

const MYNTRA_PROFILE: SiteProfile = {
  id: 'myntra',
  version: 'v1',
  match: (_url, normalized) => normalized === 'myntra.com',
  buildScrapePrompt: ({ originalUrl, basePrompt }) => `${basePrompt}\n\n${myntraOverridePrompt(originalUrl)}`,
  scrape: {
    requireHtml: true,
    requireRawHtml: true,
    fullPage: true,
    extraActions: ({ waitMs }) => {
      const extraWait = Math.max(1200, waitMs);
      return [
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
      ];
    },
    postProcess: ({ originalUrl, finalUrl, json, metadata, html, rawHtml, imageUrls }) => {
      const filtered = applyMyntraDeterministicImageFilter({ originalUrl, json, html, rawHtml });
      return {
        json: filtered.json,
        imageUrls: filtered.imageUrls,
        // Myntra: we intentionally do not persist provider metadata (HTML-derived images are source of truth).
        metadata: {},
      };
    }
  }
};

const OFFDUTY_PROFILE: SiteProfile = {
  id: 'offduty',
  version: 'v1',
  match: (_url, normalized) => normalized === 'offduty.in',
  buildScrapePrompt: ({ originalUrl, basePrompt }) => `${basePrompt}\n\n${offdutyOverridePrompt(originalUrl)}`,
  scrape: {
    requireHtml: true,
    requireRawHtml: true,
    fullPage: true,
    extraActions: ({ waitMs }) => {
      const extraWait = Math.max(1200, waitMs);
      return [
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
      ];
    },
    postProcess: ({ originalUrl, finalUrl, json, html, rawHtml }) => {
      const filtered = applyOffdutyDeterministicImageFilter({ originalUrl, finalUrl, json, html, rawHtml });
      return {
        json: filtered.json,
        imageUrls: filtered.imageUrls,
      };
    }
  }
};

const MANGO_PROFILE: SiteProfile = {
  id: 'mango',
  version: 'v1',
  match: (_url, normalized) => normalized === 'shop.mango.com',
  buildScrapePrompt: ({ originalUrl, basePrompt }) => `${basePrompt}\n\n${mangoOverridePrompt(originalUrl)}`,
  scrape: {
    requireHtml: true,
    requireRawHtml: true,
    fullPage: true,
    extraActions: ({ waitMs }) => {
      const extraWait = Math.max(1200, waitMs);
      return [
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
      ];
    },
    postProcess: ({ originalUrl, finalUrl, json, html, rawHtml }) => {
      const filtered = applyMangoDeterministicImageFilter({ originalUrl, finalUrl, json, html, rawHtml });
      return {
        json: filtered.json,
        imageUrls: filtered.imageUrls,
      };
    }
  }
};

const NYKAA_PROFILE: SiteProfile = {
  id: 'nykaa',
  version: 'v1',
  match: (_url, normalized) => normalized === 'nykaafashion.com',
  buildScrapePrompt: ({ originalUrl, basePrompt }) => `${basePrompt}\n\n${nykaaOverridePrompt(originalUrl)}`,
  scrape: {
    requireHtml: true,
    requireRawHtml: true,
    fullPage: true,
    extraActions: ({ waitMs }) => {
      const extraWait = Math.max(1200, waitMs);
      return [
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
      ];
    },
    postProcess: ({ originalUrl, finalUrl, json, html, rawHtml }) => {
      const filtered = applyNykaaDeterministicImageFilter({ originalUrl, finalUrl, json, html, rawHtml });
      return {
        json: filtered.json,
        imageUrls: filtered.imageUrls,
      };
    }
  }
};


const PUMA_PROFILE: SiteProfile = {
  id: 'puma',
  version: 'v1',
  match: (_url, normalized) => normalized === 'puma.com' || normalized.endsWith('.puma.com'),
  buildScrapePrompt: ({ originalUrl, basePrompt }) => `${basePrompt}\n\n${pumaOverridePrompt(originalUrl)}`,
  scrape: {
    requireHtml: true,
    requireRawHtml: true,
    fullPage: true,
    extraActions: ({ waitMs }) => {
      const extraWait = Math.max(1500, waitMs);
      return [
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
      ];
    },
    postProcess: ({ originalUrl, finalUrl, json, html, rawHtml }) => {
      const filtered = applyPumaDeterministicImageFilter({ originalUrl, finalUrl, json, html, rawHtml });
      return {
        json: filtered.json,
        imageUrls: filtered.imageUrls,
      };
    }
  }
};

const NISHORAMA_PROFILE: SiteProfile = {
  id: 'nishorama',
  version: 'v1',
  match: (_url, normalized) => normalized === 'nishorama.com' || normalized === 'row.nishorama.com',
  buildScrapePrompt: ({ originalUrl, basePrompt }) => `${basePrompt}\n\n${nishoramaOverridePrompt(originalUrl)}`,
  transformUrl: transformNishoramaUrl,
  scrape: {
    requireHtml: true,
    requireRawHtml: true,
    fullPage: true,
    extraActions: ({ waitMs }) => {
      const extraWait = Math.max(1200, waitMs);
      return [
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
      ];
    },
    postProcess: ({ originalUrl, finalUrl, json, html, rawHtml }) => {
      const filtered = applyNishoramaDeterministicImageFilter({ originalUrl, finalUrl, json, html, rawHtml });
      return {
        json: filtered.json,
        imageUrls: filtered.imageUrls,
      };
    }
  }
};

const BONKERSCORNER_PROFILE: SiteProfile = {
  id: 'bonkerscorner',
  version: 'v1',
  match: (_url, normalized) => normalized === 'bonkerscorner.com',
  buildScrapePrompt: ({ originalUrl, basePrompt }) => `${basePrompt}\n\n${bonkersCornerOverridePrompt(originalUrl)}`,
  scrape: {
    requireHtml: true,
    requireRawHtml: true,
    fullPage: true,
    extraActions: ({ waitMs }) => {
      const extraWait = Math.max(1200, waitMs);
      return [
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: extraWait },
      ];
    },
    postProcess: ({ originalUrl, finalUrl, json, html, rawHtml }) => {
      const filtered = applyBonkersCornerDeterministicImageFilter({ originalUrl, finalUrl, json, html, rawHtml });
      return {
        json: filtered.json,
        imageUrls: filtered.imageUrls,
      };
    }
  }
};

export type SiteSelection = {
  profile: SiteProfile;
  ctx: SiteContext;
};

export function selectSiteProfile(originalUrl: string): SiteSelection {
  const ctx = buildContext(originalUrl);
  const normalized = ctx.normalizedHostname;

  // Keep matching deterministic and ordered.
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(originalUrl);
  } catch {
    parsedUrl = null;
  }
  if (parsedUrl && isMyntraHostname(ctx.hostname) && MYNTRA_PROFILE.match(parsedUrl, normalized)) {
    return { profile: MYNTRA_PROFILE, ctx };
  }
  if (parsedUrl && isOffdutyHostname(ctx.hostname) && OFFDUTY_PROFILE.match(parsedUrl, normalized)) {
    return { profile: OFFDUTY_PROFILE, ctx };
  }
  if (parsedUrl && isMangoHostname(ctx.hostname) && MANGO_PROFILE.match(parsedUrl, normalized)) {
    return { profile: MANGO_PROFILE, ctx };
  }
  if (parsedUrl && isNykaaHostname(ctx.hostname) && NYKAA_PROFILE.match(parsedUrl, normalized)) {
    return { profile: NYKAA_PROFILE, ctx };
  }
  if (parsedUrl && isPumaHostname(ctx.hostname) && PUMA_PROFILE.match(parsedUrl, normalized)) {
    return { profile: PUMA_PROFILE, ctx };
  }
  if (parsedUrl && isNishoramaHostname(ctx.hostname) && NISHORAMA_PROFILE.match(parsedUrl, normalized)) {
    return { profile: NISHORAMA_PROFILE, ctx };
  }
  if (parsedUrl && isBonkersCornerHostname(ctx.hostname) && BONKERSCORNER_PROFILE.match(parsedUrl, normalized)) {
    return { profile: BONKERSCORNER_PROFILE, ctx };
  }

  return { profile: DEFAULT_PROFILE, ctx };
}
