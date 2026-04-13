import axios from 'axios';
import { config } from '../../config/index';
import type { FirecrawlAction, FirecrawlScrapePostProcessor } from '../../sites/types';

export type FirecrawlResult = {
  finalUrl: string;
  json: unknown;
  metadata: Record<string, unknown>;
  imageUrls: string[];
  links?: unknown;
  html?: string;
  rawHtml?: string;
};

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const http = axios.create();
if (config.DEBUG_FIRECRAWL === 'true') {
  http.interceptors.request.use((req) => {
    console.error('[firecrawl:req]', { url: req.url, method: req.method, data: req.data });
    return req;
  });
  http.interceptors.response.use((res) => {
    console.error('[firecrawl:res]', { url: res.config?.url, status: res.status, data: res.data });
    return res;
  }, (err) => {
    console.error('[firecrawl:err]', String(err));
    throw err;
  });
}

// ========== SCRAPE (default) ==========
type FirecrawlErrorCategory = 'rate_limited' | 'timeout' | 'access_denied' | 'provider_error';

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function classifyFirecrawlFailure(status: number, body: unknown): FirecrawlErrorCategory {
  if (status === 429) return 'rate_limited';
  if (status === 403 || status === 401) return 'access_denied';
  // many providers surface blocks as 503/520/521 etc; treat them as provider_error to allow limited retries
  if (status === 408 || status === 504) return 'timeout';
  const rec = asRecord(body);
  const msg = String(rec['error'] ?? rec['message'] ?? '');
  if (/timeout/i.test(msg)) return 'timeout';
  if (/forbidden|denied|blocked|captcha/i.test(msg)) return 'access_denied';
  return 'provider_error';
}

function jitter(ms: number) {
  const spread = Math.max(80, Math.floor(ms * 0.25));
  return ms + Math.floor(Math.random() * spread);
}

function buildScrapeActionsV2(strategy: string, waitMs: number) {
  if (strategy === 'none') return [] as Array<Record<string, unknown>>;
  const base: Array<Record<string, unknown>> = [
    { type: 'wait', milliseconds: waitMs },
    { type: 'scroll', direction: 'down' },
    { type: 'wait', milliseconds: Math.max(600, Math.floor(waitMs * 0.8)) },
    { type: 'scroll', direction: 'down' },
    { type: 'wait', milliseconds: waitMs }
  ];
  if (strategy === 'minimal') return base;

  // generic, very small set of label clicks + size guide attempts (best-effort)
  const acts: Array<Record<string, unknown>> = [...base];
  const labels = ['Description', 'Details', 'More info'];
  for (const label of labels) {
    acts.push({ type: 'click', selector: `text=${label}` });
    acts.push({ type: 'wait', milliseconds: waitMs });
  }
  const sizeSelectors = [
    'text=/size chart/i',
    'text=/size guide/i',
    'text=/size & fit/i',
    'text=/fit guide/i',
    'text=/product measurement/i',
    'role=button[name=/size chart/i]',
    'role=button[name=/size guide/i]',
    'role=button[name=/product measurement/i]',
    'role=link[name=/size chart/i]',
    'role=link[name=/size guide/i]'
  ];
  for (const selector of sizeSelectors) {
    acts.push({ type: 'click', selector });
    acts.push({ type: 'wait', milliseconds: waitMs });
  }
  return acts;
}

function normalizeImageUrls(value: unknown): string[] {
  const urls: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') urls.push(entry);
      else if (isRecord(entry) && typeof entry['url'] === 'string') urls.push(entry['url']);
    }
  } else if (isRecord(value) && Array.isArray(value['images'])) {
    return normalizeImageUrls(value['images']);
  }
  return Array.from(new Set(urls));
}

export type FirecrawlScrapeOverrides = {
  prompt?: string;
  includeHtml?: boolean;
  includeRawHtml?: boolean;
  actions?: FirecrawlAction[];
  postProcess?: FirecrawlScrapePostProcessor;
  fullPage?: boolean;
};

function tryParseProviderError(value: unknown): { status?: number; scope?: string; provider?: unknown } | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? (parsed as { status?: number; scope?: string; provider?: unknown }) : null;
  } catch {
    return null;
  }
}

async function runScrapeV2Once(originalUrl: string, apiKey: string, overrides?: FirecrawlScrapeOverrides): Promise<FirecrawlResult> {
  const endpoint = 'https://api.firecrawl.dev/v2/scrape';

  const prompt = overrides?.prompt ?? config.SCRAPE_JSON_BASICS_PROMPT;

  const formats: Array<string | Record<string, unknown>> = [];
  formats.push({ type: 'json', prompt });
  if (overrides?.includeHtml ?? (config.SCRAPE_INCLUDE_HTML === 'true')) formats.push('html');
  if (overrides?.includeRawHtml ?? config.FIRECRAWL_SCRAPE_INCLUDE_RAW_HTML) formats.push('rawHtml');

  const actions = overrides?.actions ?? buildScrapeActionsV2(config.SCRAPE_ACTIONS_STRATEGY, config.SCRAPE_WAIT_MS);

  const body: Record<string, unknown> = {
    url: originalUrl,
    formats
  };
  if (overrides?.fullPage ?? config.FIRECRAWL_SCRAPE_FULL_PAGE) {
    // Firecrawl v2: full page scraping requires onlyMainContent=false
    body['onlyMainContent'] = false;
  }
  if (actions.length > 0) body['actions'] = actions;

  const resp = await http.post(endpoint, body, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: Math.max(30000, clampInt(config.SCRAPE_TIMEOUT_MS + 15000, 30000, 180000)),
    validateStatus: () => true
  });

  if (resp.status >= 400) {
    throw new Error(JSON.stringify({
      scope: 'scrape-v2-post',
      status: resp.status,
      category: classifyFirecrawlFailure(resp.status, resp.data),
      url: originalUrl,
      provider: resp.data
    }));
  }

  const root = asRecord(resp.data);
  const data = isRecord(root['data']) ? (root['data'] as Record<string, unknown>) : root;
  const metadata = isRecord(data['metadata']) ? (data['metadata'] as Record<string, unknown>) : {};
  const finalUrl = asString(metadata['sourceURL'])
    ?? asString(metadata['sourceUrl'])
    ?? asString(data['finalUrl'])
    ?? originalUrl;
  const links = data['links'];
  const html = asString(data['html']);
  const rawHtml = asString(data['rawHtml']);

  let json: Record<string, unknown> = isRecord(data['json']) ? (data['json'] as Record<string, unknown>) : {};
  let imageUrls = normalizeImageUrls(json['images']);
  let metadataToPersist = metadata;
  if (overrides?.postProcess) {
    const processed = overrides.postProcess({
      originalUrl,
      finalUrl,
      json,
      metadata,
      html,
      rawHtml,
      imageUrls
    });
    json = processed.json;
    imageUrls = processed.imageUrls;
    metadataToPersist = processed.metadata ?? metadata;
  }

  return { finalUrl, json, metadata: metadataToPersist, imageUrls, links, html, rawHtml };
}

async function runScrapeV2(originalUrl: string, apiKey: string, overrides?: FirecrawlScrapeOverrides): Promise<FirecrawlResult> {
  // Best-effort: request rawHtml when asked, but don't fail the scrape if Firecrawl rejects the format.
  try {
    return await runScrapeV2Once(originalUrl, apiKey, overrides);
  } catch (err: unknown) {
    if (!overrides?.includeRawHtml) throw err;
    const parsed = tryParseProviderError(err instanceof Error ? err.message : err);
    const provider = asRecord(parsed?.provider);
    const providerMessage = String(provider['error'] ?? provider['message'] ?? '');
    const status = parsed?.status;
    const scope = parsed?.scope;
    const looksLikeFormatFailure =
      scope === 'scrape-v2-post'
      && status === 400
      && /format|formats|rawhtml/i.test(providerMessage);
    if (!looksLikeFormatFailure) throw err;
    return runScrapeV2Once(originalUrl, apiKey, { ...overrides, includeRawHtml: false });
  }
}

async function runScrapeV1(originalUrl: string, apiKey: string, overrides?: FirecrawlScrapeOverrides): Promise<FirecrawlResult> {
  const endpoint = 'https://api.firecrawl.dev/v1/scrape';
  const formats = ['json'];
  if (overrides?.includeHtml ?? (config.SCRAPE_INCLUDE_HTML === 'true')) formats.push('html');

  const body: Record<string, unknown> = { url: originalUrl, formats };
  if (formats.includes('json')) {
    body['jsonOptions'] = { prompt: overrides?.prompt ?? config.SCRAPE_JSON_BASICS_PROMPT };
  }

  const resp = await http.post(endpoint, body, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 90000,
    validateStatus: () => true
  });
  if (resp.status >= 400) {
    throw new Error(JSON.stringify({
      scope: 'scrape-v1-post',
      status: resp.status,
      category: classifyFirecrawlFailure(resp.status, resp.data),
      url: originalUrl,
      provider: resp.data
    }));
  }

  const data = resp.data?.data || {};
  const metadata = isRecord(data.metadata) ? (data.metadata as Record<string, unknown>) : {};
  const finalUrl = asString((metadata as Record<string, unknown>)['sourceURL']) ?? originalUrl;
  const html = asString(data.html);
  const rawHtml = asString(data.rawHtml);

  let json: Record<string, unknown> = isRecord(data.json) ? (data.json as Record<string, unknown>) : {};
  let imageUrls = normalizeImageUrls(json['images']);
  let metadataToPersist = metadata;
  if (overrides?.postProcess) {
    const processed = overrides.postProcess({
      originalUrl,
      finalUrl,
      json,
      metadata,
      html,
      rawHtml,
      imageUrls
    });
    json = processed.json;
    imageUrls = processed.imageUrls;
    metadataToPersist = processed.metadata ?? metadata;
  }
  return { finalUrl, json, metadata: metadataToPersist, imageUrls, html, rawHtml };
}

// ========== EXTRACT (opt-in) ==========
async function runExtractV2(originalUrl: string, apiKey: string): Promise<FirecrawlResult> {
  const endpoint = 'https://api.firecrawl.dev/v2/extract';
  // Minimal schema for compatibility (fuller schema can be used when needed via prompt)
  const extractionSchema = {
    type: 'object',
    properties: {
      product: {
        type: 'object',
        properties: {
          brand: { type: ['string', 'null'] },
          product_name: { type: ['string', 'null'] },
          product_url: { type: ['string', 'null'] },
          size: { type: ['string', 'null'] },
          price: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          image_url: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          color: { type: ['string', 'null'] },
          color_group: { type: ['string', 'null'] },
          fit: { type: ['string', 'null'] },
          feel: { type: ['string', 'null'] },
          vibes: { type: ['string', 'null'] },
          gender: { type: ['string', 'null'] },
          size_chart: { type: ['object', 'null'] },
          material: { type: ['string', 'null'] },
          care: { type: ['string', 'null'] },
          product_specifications: { type: ['object', 'null'] },
        }
      },
      images: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: ['string', 'null'] },
            kind: { type: ['string', 'null'] },
            is_primary: { type: ['boolean', 'null'] },
            sort_order: { type: ['number', 'null'] },
            gender: { type: ['string', 'null'] },
            vto_eligible: { type: ['boolean', 'null'] }
          }
        }
      }
    }
  };
  const prompt = `Extract comprehensive product data matching the schema. Fill nullable fields when information is present on the page and set them to null when it is missing. Include brand, product_name, product_url, size, price/price_minor (convert to smallest currency unit) with currency, primary image_url, long description, description_text, color, fit, feel, vibes, gender, category_id, size_chart, material, care, product_specifications. Capture gallery images with url, kind, primary flag, sort order, gender, and vto eligibility hints.`;

  const body: Record<string, unknown> = { urls: [originalUrl], schema: extractionSchema, prompt };
  if (config.FIRECRAWL_EXTRACT_USE_AGENT === 'true') body['agent'] = { model: config.FIRECRAWL_EXTRACT_AGENT_MODEL };

  const resp = await http.post(endpoint, body, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 90000,
    validateStatus: () => true
  });
  if (resp.status >= 400) throw new Error(JSON.stringify({ scope: 'extract-post', status: resp.status, url: originalUrl, provider: resp.data }));

  let json: unknown = resp.data?.data;
  const jobId = resp.data?.id;
  let status = resp.data?.status;

  if (!json && jobId) {
    const pollStart = Date.now();
    while (Date.now() - pollStart < config.FIRECRAWL_EXTRACT_POLL_TIMEOUT_MS) {
      await sleep(config.FIRECRAWL_EXTRACT_POLL_INTERVAL_MS);
      const statusResp = await http.get(`${endpoint}/${jobId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 20000,
        validateStatus: () => true
      });
      if (statusResp.status >= 400) throw new Error(JSON.stringify({ scope: 'extract-status', status: statusResp.status, url: originalUrl, jobId, provider: statusResp.data }));
      status = statusResp.data?.status;
      if (status === 'completed') { json = statusResp.data?.data; break; }
      if (status === 'failed' || status === 'cancelled') {
        console.error({ scope: 'extract-status', url: originalUrl, jobId, fullResponse: statusResp.data });
        throw new Error(JSON.stringify({ scope: 'extract-status', status, url: originalUrl, jobId, provider: statusResp.data }));
      }
    }
    if (!json) throw new Error(JSON.stringify({ scope: 'extract-status', status: 'timeout', url: originalUrl, jobId }));
  }

  const imageUrls: string[] = normalizeImageUrls(json);
  return { finalUrl: originalUrl, json, metadata: {}, imageUrls };
}

// ========== Public unified call ==========
export async function fetchWithFirecrawl(
  originalUrl: string,
  apiKey: string,
  options?: { scrape?: FirecrawlScrapeOverrides }
): Promise<FirecrawlResult> {
  if (config.FIRECRAWL_MODE === 'extract') {
    return runExtractV2(originalUrl, apiKey);
  }
  if (config.FIRECRAWL_SCRAPE_API_VERSION === 'v1') {
    return runScrapeV1(originalUrl, apiKey, options?.scrape);
  }
  return runScrapeV2(originalUrl, apiKey, options?.scrape);
}
