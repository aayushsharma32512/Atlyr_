import { config } from '../config/index';
import type { FirecrawlAction, FirecrawlScrapePostProcessor, SiteContext, SiteId } from './types';
import { selectSiteProfile } from './registry';

export type FirecrawlScrapePlan = {
  profileId: SiteId;
  profileVersion: string;
  ctx: SiteContext;
  prompt: string;
  includeHtml: boolean;
  includeRawHtml: boolean;
  fullPage: boolean;
  actions: FirecrawlAction[];
  postProcess?: FirecrawlScrapePostProcessor;
  /** Optional URL transformation function */
  transformUrl?: (originalUrl: string) => string;
};

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

export function buildFirecrawlScrapePlan(originalUrl: string): FirecrawlScrapePlan {
  const { profile, ctx } = selectSiteProfile(originalUrl);

  const prompt = profile.buildScrapePrompt({
    originalUrl,
    basePrompt: config.SCRAPE_JSON_BASICS_PROMPT,
    ctx
  });

  const includeHtml = (config.SCRAPE_INCLUDE_HTML === 'true') || Boolean(profile.scrape?.requireHtml);
  const includeRawHtml = Boolean(profile.scrape?.requireRawHtml) || Boolean(config.FIRECRAWL_SCRAPE_INCLUDE_RAW_HTML);
  const fullPage = Boolean(profile.scrape?.fullPage) || Boolean(config.FIRECRAWL_SCRAPE_FULL_PAGE);
  const actions = buildScrapeActionsV2(config.SCRAPE_ACTIONS_STRATEGY, config.SCRAPE_WAIT_MS);
  if (profile.scrape?.extraActions) {
    actions.push(...profile.scrape.extraActions({ originalUrl, ctx, waitMs: config.SCRAPE_WAIT_MS }));
  }

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    ctx,
    prompt,
    includeHtml,
    includeRawHtml,
    fullPage,
    actions,
    postProcess: profile.scrape?.postProcess,
    transformUrl: profile.transformUrl
  };
}
