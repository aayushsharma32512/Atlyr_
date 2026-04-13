export type SiteId = 'default' | 'myntra' | 'offduty' | 'mango' | 'nykaa' | 'puma' | 'nishorama' | 'bonkerscorner';

export type SiteContext = {
  hostname: string;
  normalizedHostname: string;
  // Site-specific dynamic variables (optional)
  styleId?: string | null;
  productId?: string | null;
};

export type FirecrawlAction = Record<string, unknown>;

export type FirecrawlScrapePostProcessor = (params: {
  originalUrl: string;
  finalUrl: string;
  json: Record<string, unknown>;
  metadata: Record<string, unknown>;
  html?: string;
  rawHtml?: string;
  imageUrls: string[];
}) => {
  json: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  imageUrls: string[];
};

export type SiteProfile = {
  id: SiteId;
  version: string;
  match: (url: URL, normalizedHostname: string) => boolean;
  buildScrapePrompt: (params: { originalUrl: string; basePrompt: string; ctx: SiteContext }) => string;
  /** Optional URL transformation before scraping (e.g., handling redirects) */
  transformUrl?: (originalUrl: string) => string;
  scrape?: {
    requireHtml?: boolean;
    requireRawHtml?: boolean;
    fullPage?: boolean;
    extraActions?: (params: { originalUrl: string; ctx: SiteContext; waitMs: number }) => FirecrawlAction[];
    postProcess?: FirecrawlScrapePostProcessor;
  };
};
