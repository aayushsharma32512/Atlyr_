import type PgBoss from 'pg-boss';
import { createLogger } from '../utils/logger';
import { TOPICS } from '../queue/topics';
import { config } from '../config/index';
import { CrawlPayload, CrawlOutput } from '../domain/contracts';
import { fetchWithFirecrawl } from '../adapters/crawler/firecrawl';
import { buildFirecrawlScrapePlan } from '../sites/firecrawlPlan';
import { persistFirecrawlArtifacts } from '../utils/firecrawlArtifacts';

export async function registerCrawlWorker(boss: PgBoss) {
  const logger = createLogger({ stage: 'crawl' });
  await boss.work(TOPICS.CRAWL, async (job: { id: string; data: unknown }) => {
    const parsed = CrawlPayload.safeParse(job.data);
    if (!parsed.success) {
      logger.error({ jobId: job.id }, 'Invalid crawl payload');
      return;
    }
    const { jobId, originalUrl } = parsed.data;

    if (!config.FIRECRAWL_API_KEY) {
      logger.error({ jobId }, 'FIRECRAWL_API_KEY missing');
      return;
    }

    try {
      const plan = buildFirecrawlScrapePlan(originalUrl);

      // Directly transform nishorama URLs: www.nishorama.com → row.nishorama.com
      let scrapeUrl = originalUrl;
      try {
        const parsed = new URL(originalUrl);
        const host = parsed.hostname.toLowerCase();
        if (host === 'www.nishorama.com' || host === 'nishorama.com') {
          parsed.hostname = 'row.nishorama.com';
          scrapeUrl = parsed.toString();
          logger.info({ jobId, originalUrl, scrapeUrl }, 'Transformed nishorama URL');
        }
      } catch {
        // Keep original URL on parse error
      }

      const result = await fetchWithFirecrawl(scrapeUrl, config.FIRECRAWL_API_KEY, {
        scrape: {
          prompt: plan.prompt,
          includeHtml: plan.includeHtml,
          includeRawHtml: plan.includeRawHtml,
          fullPage: plan.fullPage,
          actions: plan.actions,
          postProcess: plan.postProcess
        }
      });

      const mode = config.FIRECRAWL_MODE;
      const artifactRefs = await persistFirecrawlArtifacts({ jobId, mode, result });
      logger.info({ jobId, ...artifactRefs }, mode === 'extract' ? 'Stored Firecrawl extract artifact' : 'Stored Firecrawl scrape artifacts');

      const output: unknown = {
        finalUrl: result.finalUrl,
        artifactRefs,
        imageUrls: Array.from(new Set(result.imageUrls ?? [])),
        crawl_meta: {
          siteProfileId: plan.profileId,
          siteProfileVersion: plan.profileVersion
        }
      };
      const ok = CrawlOutput.safeParse(output);
      if (!ok.success) {
        logger.warn({ jobId }, 'Crawl output failed validation');
      }

      const hasJson = !!result.json && Object.keys(result.json as object).length > 0;
      const imgCount = (result.imageUrls || []).length;
      logger.info({ jobId, hasJson, imgCount }, config.FIRECRAWL_MODE === 'extract' ? 'Extract completed (v2)' : 'Scrape completed (v1 JSON mode)');

      await boss.send(
        TOPICS.EXTRACT,
        { ...parsed.data, artifactRefs },
        { retryLimit: 3, retryBackoff: true }
      );

      await boss.send(
        TOPICS.DOWNLOAD,
        { ...parsed.data, artifactRefs },
        { retryLimit: 5, retryBackoff: true }
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ jobId, originalUrl, error: message }, 'Crawl failed');
      throw err;
    }
  });
}
