import { z } from 'zod';

// Empty strings in .env are treated as absent (undefined) for optional fields.
const optStr = z.string().min(1).optional().or(z.literal('').transform(() => undefined as undefined));
const optUrl = z.string().url().optional().or(z.literal('').transform(() => undefined as undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  PORT: z.string().default('3001'),

  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL_DIRECT: z.string().url(),

  STORAGE_BUCKET: z.string().default('ingestion-automated'),

  FIRECRAWL_API_KEY: optStr,
  FIRECRAWL_MAX_CONCURRENCY: z.string().default('3'),
  // Country whose storefront the scrape should see. Firecrawl's proxies exit in the US by default,
  // and geo-localised stores then serve a converted price in the local currency. The catalogue is
  // Indian, so render as an Indian visitor unless told otherwise.
  FIRECRAWL_COUNTRY: z.string().length(2).default('IN'),
  FIRECRAWL_LANGUAGE: z.string().default('en-IN'),
  // Currency recorded when a page declares none and its TLD implies none (the .com case).
  DEFAULT_CURRENCY: z.string().length(3).default('INR'),

  GOOGLE_API_KEY: optStr,
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.5-flash'),
  // Comma-separated models tried in order when the primary is unavailable (503/404).
  GEMINI_TEXT_MODEL_FALLBACKS: z.string().default('gemini-3.6-flash,gemini-flash-latest'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-3-pro-image'),
  // Comma-separated image models tried in order when the primary is overloaded (503) or
  // missing (404) — same fallback pattern as GEMINI_TEXT_MODEL_FALLBACKS.
  GEMINI_IMAGE_MODEL_FALLBACKS: z.string().default('gemini-3-flash-image,gemini-3-flash-image-lite,gemini-2.5-flash-image'),
  SIGLIP_ENDPOINT: optUrl,
  SIGLIP_API_KEY: optStr,

  FASHN_VTON_API_URL: optUrl,
  FASHN_VTON_API_KEY: optStr,
  SEEDREAM_API_URL: optUrl,
  SEEDREAM_API_KEY: optStr,

  FASHN_SEG_API_URL: optUrl,
  SCHP_SEG_API_URL: optUrl,
  GDINO_API_URL: optUrl,
  SAM_V2_API_URL: optUrl,
  FASHN_SEG_REFINE_API_URL: optUrl,
  VITMATTE_API_URL: optUrl,
  BIREFNET_API_URL: optUrl,

  BOSS_SCHEMA: z.string().default('pgboss_ingestion_v2'),
  BOSS_TEAM_SIZE: z.string().default('5'),
  // How long COMPLETED pg-boss rows are kept before being archived. Housekeeping only —
  // this has never governed how long a running step may take (see BOSS_STEP_TIMEOUT_SECONDS).
  BOSS_EXPIRE_AFTER: z.string().default('PT2H'),
  // How long ONE pipeline step may stay active before pg-boss expires the job. Previously unset,
  // which silently meant pg-boss's 15-minute default — shorter than a cold-start Modal segmentation.
  // Note expiry does NOT cancel the in-flight handler; it only stops the queue tracking it.
  BOSS_STEP_TIMEOUT_SECONDS: z.string().default('1800'),
  // Same, for steps that block on a Modal call (segmenting, placement). Expiry does not cancel the
  // handler, so this must comfortably exceed the slowest Modal run or a retry will execute
  // concurrently with the original.
  BOSS_MODAL_STEP_TIMEOUT_SECONDS: z.string().default('5400'),
  // Retries exist only to recover steps interrupted by the worker process dying. Ordinary step
  // failures are already terminal by the time a retry runs, so they are not re-executed.
  BOSS_STEP_RETRY_LIMIT: z.string().default('3'),
  BOSS_STEP_RETRY_DELAY_SECONDS: z.string().default('60'),
  // Extra idle time on top of the step timeout before the reaper will call a job stranded.
  // Must stay > 0 so a step that is legitimately still running is never reaped.
  BOSS_REAP_GRACE_SECONDS: z.string().default('300'),
  // What the boot reaper does with rows it considers stranded. Defaults to 'log' — report only,
  // mutate nothing. Flip to 'fail' once the logged candidates have proven to be genuinely stuck;
  // a false positive here fails work that is actually still running.
  REAPER_MODE: z.enum(['off', 'log', 'fail']).default('log'),
  BOSS_RESTART_BASE_MS: z.string().default('1000'),
  BOSS_RESTART_MAX_MS: z.string().default('15000'),
  BOSS_RESTART_MAX_ATTEMPTS: z.string().default('5'),

  API_TOKEN: z.string().min(1),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten());
  process.exit(1);
}

export const config = {
  ...parsed.data,
  PORT: Number(parsed.data.PORT),
  BOSS_TEAM_SIZE: Number(parsed.data.BOSS_TEAM_SIZE),
  BOSS_STEP_TIMEOUT_SECONDS: Number(parsed.data.BOSS_STEP_TIMEOUT_SECONDS),
  BOSS_MODAL_STEP_TIMEOUT_SECONDS: Number(parsed.data.BOSS_MODAL_STEP_TIMEOUT_SECONDS),
  BOSS_STEP_RETRY_LIMIT: Number(parsed.data.BOSS_STEP_RETRY_LIMIT),
  BOSS_STEP_RETRY_DELAY_SECONDS: Number(parsed.data.BOSS_STEP_RETRY_DELAY_SECONDS),
  BOSS_REAP_GRACE_SECONDS: Number(parsed.data.BOSS_REAP_GRACE_SECONDS),
  BOSS_RESTART_BASE_MS: Number(parsed.data.BOSS_RESTART_BASE_MS),
  BOSS_RESTART_MAX_MS: Number(parsed.data.BOSS_RESTART_MAX_MS),
  BOSS_RESTART_MAX_ATTEMPTS: Number(parsed.data.BOSS_RESTART_MAX_ATTEMPTS),
  FIRECRAWL_MAX_CONCURRENCY: Number(parsed.data.FIRECRAWL_MAX_CONCURRENCY),
} as const;
