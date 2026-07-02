import { normalizeHostname } from './shared';
import { isMyntra, extractMyntraImages } from './myntra';
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
