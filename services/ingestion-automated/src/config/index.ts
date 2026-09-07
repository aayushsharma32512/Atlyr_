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

  // One key, or several comma-separated in priority order. A key that runs out of credits returns
  // 402 and stays dead until someone tops it up — with a single key that kills the scrape step for
  // the whole sheet (observed: batch 147 lost jobs to 402 mid-run). Listing spares lets the adapter
  // walk to the next one instead.
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
  // Priority-ordered Gemini routes: 'ai_studio' (API key, fixed per-project quota) and/or
  // 'vertex:<location>' (ADC auth, Dynamic Shared Quota — each location is its own pool;
  // 'global' lets Google pick a region). First healthy route wins; a 429 pauses the route
  // and traffic falls through to the next. e.g. 'ai_studio,vertex:global'.
  GEMINI_ROUTES: z.string().default('ai_studio'),
  // GCP project id serving the vertex:* routes. Auth comes from Application Default
  // Credentials — set GOOGLE_APPLICATION_CREDENTIALS to the service-account key path locally.
  GOOGLE_VERTEX_PROJECT: optStr,
  // Max concurrent in-flight requests per route (the AIMD governor halves it on a 429 and
  // recovers toward it on sustained success).
  GEMINI_ROUTE_MAX_CONCURRENT: z.string().default('8'),
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.5-flash'),
  // Comma-separated models tried in order when the primary is unavailable (503/404).
  GEMINI_TEXT_MODEL_FALLBACKS: z.string().default('gemini-3.6-flash,gemini-flash-latest'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-3-pro-image'),
  // Comma-separated image models tried in order when the primary is overloaded (503), missing
  // (404), or refuses to produce an image (safety filter) — same pattern as the text fallbacks.
  // 'gemini-3-flash-image'/'-lite' were never real model ids (confirmed 404 in production logs);
  // the flash-tier image model is gemini-3.1-flash-image.
  //
  // gemini-2.5-flash-image was REMOVED on 2026-08-14: it accepts imageConfig.imageSize='2K'
  // without erroring but silently returns 1K (measured 768x1376 vs the 1536x2752 the other two
  // deliver), and it composes on a black background when the prompt does not pin one. Both are
  // model-generation properties, not prompt problems — it predates 2K output support. Adding it
  // back trades catalogue-grade output for capacity during 429 storms.
  GEMINI_IMAGE_MODEL_FALLBACKS: z.string().default('gemini-3.1-flash-image'),
  SIGLIP_ENDPOINT: optUrl,
  SIGLIP_API_KEY: optStr,

  FASHN_VTON_API_URL: optUrl,
  FASHN_VTON_API_KEY: optStr,
  SEEDREAM_API_URL: optUrl,
  SEEDREAM_API_KEY: optStr,

  // ─── Modal GPU endpoints ──────────────────────────────────────────────────
  // Previously read from bare process.env inside the step handlers, so a missing or malformed
  // value failed mid-job — after scraping, identification, summary and VTON had already been
  // paid for. Validated here instead, so it fails at boot.
  MODAL_SEGMENTATION_URL: optUrl,
  MODAL_PLACEMENT_URL: optUrl,
  // Client-side ceiling on one Modal call. Must exceed Modal's own 600s function cap plus
  // container scheduling/cold start, and stay well under BOSS_MODAL_STEP_TIMEOUT_SECONDS so the
  // handler fails on its own terms instead of being expired by pg-boss while still running.
  MODAL_REQUEST_TIMEOUT_SECONDS: z.string().default('900'),

  FASHN_SEG_API_URL: optUrl,
  SCHP_SEG_API_URL: optUrl,
  GDINO_API_URL: optUrl,
  SAM_V2_API_URL: optUrl,
  FASHN_SEG_REFINE_API_URL: optUrl,
  VITMATTE_API_URL: optUrl,
  BIREFNET_API_URL: optUrl,

  // ─── Economy lane (AI Studio batch VTON) ───────────────────────────────────
  // Off by default. Disabling stops the COLLECTOR ONLY — the poller, janitor and deadline keep
  // running until every in-flight tray drains, because switching the lane off must never strand
  // jobs already parked at Google.
  VTON_BATCH_ENABLED: z.string().default('false'),
  // Pinned by the Phase 0 spike (2026-08-18): gemini-3-pro-image, verified to return 2K in batch.
  VTON_BATCH_MODEL: z.string().default('gemini-3-pro-image'),
  // Tray size. 30 bounds both the blast radius of a failed tray and the response memory a poller
  // tick holds (~30 x ~1.3 MB of base64 image). Raising it wants the JSONL path with streaming.
  VTON_BATCH_FLUSH_SIZE: z.string().default('30'),
  // A tray is SUBMITTED when it is full OR when its oldest member has waited too long. Without
  // an explicit trigger the collector ships whatever happens to be parked on each tick, which
  // produces trays of one or two whenever jobs arrive slower than the cron — many tiny batches
  // instead of one real one. FLUSH_SIZE alone is only an upper bound, never a reason to wait.
  VTON_BATCH_MIN_FILL: z.string().default('10'),
  // The escape hatch that stops a trickle being stranded forever below MIN_FILL.
  VTON_BATCH_MAX_WAIT_SECONDS: z.string().default('900'),
  VTON_BATCH_FLUSH_CRON: z.string().default('*/5 * * * *'),
  VTON_BATCH_POLL_CRON: z.string().default('*/3 * * * *'),
  // How long a 'submitting' row may sit with no provider_batch_name before the janitor releases
  // its claimed jobs. Covers a crash between claiming and submitting; zero spend either way.
  VTON_BATCH_SUBMIT_GRACE_SECONDS: z.string().default('900'),
  // Warn (and badge the dashboard) when a tray has been pending this long. Without it the first
  // signal of a broken lane is the bill.
  VTON_BATCH_STALE_WARN_SECONDS: z.string().default('21600'),
  // Concurrent garment fetches while a tray is built. Bounded so one collector tick cannot
  // saturate the network for the rest of the pipeline.
  VTON_BATCH_FETCH_CONCURRENCY: z.string().default('6'),

  BOSS_SCHEMA: z.string().default('pgboss_ingestion_v2'),
  BOSS_TEAM_SIZE: z.string().default('5'),
  // Worker slots for the Modal-driven queue (segmenting, placement). Those steps block a slot for
  // minutes waiting on a GPU, so they get their own pool — otherwise, at any useful BOSS_TEAM_SIZE,
  // most slots end up parked on Modal while fast steps (scrape/identify/summary/vton) queue behind.
  BOSS_MODAL_TEAM_SIZE: z.string().default('5'),
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
  // Flipped from 'log' to 'fail' when the custodian took ownership of this pass. It had run only
  // at boot and only in 'log' mode, so in practice it had never acted at all — a rescue path the
  // rest of the pipeline assumed existed.
  REAPER_MODE: z.enum(['off', 'log', 'fail']).default('fail'),
  // The periodic custodian: resumes orphans, bounds the Modal states, reaps stranded rows. The
  // kill switch is here rather than per-pass because all three share one tick.
  CUSTODIAN_ENABLED: z.string().default('true'),
  CUSTODIAN_CRON: z.string().default('*/5 * * * *'),
  // Retry failures that were about CONDITIONS (a dead key, a rate limit that outlasted the
  // dispatcher's patience) rather than about the job. Without this, `failed` is a dead end that
  // only a human clicking restart can escape — which is how one 402 stranded a row indefinitely.
  AUTO_RETRY_FAILED: z.string().default('true'),
  // How long a failure must sit before the custodian touches it. Long enough that an operator sees
  // it first and that the upstream condition has had a chance to actually change; retrying a dead
  // key every five minutes just re-asks a question already answered.
  AUTO_RETRY_MIN_IDLE_SECONDS: z.string().default('1800'),
  // Bound on automatic retries, read from error_count. A human restart zeroes that counter and so
  // grants a fresh budget; the custodian only ever spends the existing one.
  AUTO_RETRY_MAX_ATTEMPTS: z.string().default('5'),
  // How many times a step may be deferred on a retryable error (rate limit, transient upstream)
  // before the job is failed for good. Bounds the one thing a defer-instead-of-fail policy can get
  // wrong: a permanently broken upstream cycling jobs forever with no failure ever surfacing.
  STEP_MAX_ATTEMPTS: z.string().default('5'),
  // Wait used when the upstream named no delay of its own. Long enough to outlive an ordinary rate
  // limit window rather than landing back inside it, which is how the in-adapter retries died.
  STEP_RETRY_FALLBACK_SECONDS: z.string().default('60'),
  // What boot recovery does with work the previous process died holding. 'resume' re-dispatches
  // each job at the step it stopped on — the point being that a crash or a Ctrl-C should never
  // need a human to re-drive a batch. Unlike the reaper this is safe to act on automatically:
  // it runs before the workers register, so anything still marked `active` provably belongs to a
  // process that no longer exists. 'log' reports only; 'off' disables it.
  BOOT_RECOVERY: z.enum(['off', 'log', 'resume']).default('resume'),
  BOSS_RESTART_BASE_MS: z.string().default('1000'),
  BOSS_RESTART_MAX_MS: z.string().default('15000'),
  BOSS_RESTART_MAX_ATTEMPTS: z.string().default('5'),
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
  BOSS_MODAL_TEAM_SIZE: Number(parsed.data.BOSS_MODAL_TEAM_SIZE),
  BOSS_STEP_TIMEOUT_SECONDS: Number(parsed.data.BOSS_STEP_TIMEOUT_SECONDS),
  BOSS_MODAL_STEP_TIMEOUT_SECONDS: Number(parsed.data.BOSS_MODAL_STEP_TIMEOUT_SECONDS),
  BOSS_STEP_RETRY_LIMIT: Number(parsed.data.BOSS_STEP_RETRY_LIMIT),
  BOSS_STEP_RETRY_DELAY_SECONDS: Number(parsed.data.BOSS_STEP_RETRY_DELAY_SECONDS),
  BOSS_REAP_GRACE_SECONDS: Number(parsed.data.BOSS_REAP_GRACE_SECONDS),
  BOSS_RESTART_BASE_MS: Number(parsed.data.BOSS_RESTART_BASE_MS),
  BOSS_RESTART_MAX_MS: Number(parsed.data.BOSS_RESTART_MAX_MS),
  BOSS_RESTART_MAX_ATTEMPTS: Number(parsed.data.BOSS_RESTART_MAX_ATTEMPTS),
  FIRECRAWL_MAX_CONCURRENCY: Number(parsed.data.FIRECRAWL_MAX_CONCURRENCY),
  CUSTODIAN_ENABLED: parsed.data.CUSTODIAN_ENABLED === 'true',
  AUTO_RETRY_FAILED: parsed.data.AUTO_RETRY_FAILED === 'true',
  AUTO_RETRY_MIN_IDLE_SECONDS: Number(parsed.data.AUTO_RETRY_MIN_IDLE_SECONDS),
  AUTO_RETRY_MAX_ATTEMPTS: Number(parsed.data.AUTO_RETRY_MAX_ATTEMPTS),
  STEP_MAX_ATTEMPTS: Number(parsed.data.STEP_MAX_ATTEMPTS),
  STEP_RETRY_FALLBACK_SECONDS: Number(parsed.data.STEP_RETRY_FALLBACK_SECONDS),
  GEMINI_ROUTE_MAX_CONCURRENT: Number(parsed.data.GEMINI_ROUTE_MAX_CONCURRENT),
  /** Firecrawl keys in priority order; a single key parses to a one-element list. */
  FIRECRAWL_API_KEYS: (parsed.data.FIRECRAWL_API_KEY ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  MODAL_REQUEST_TIMEOUT_SECONDS: Number(parsed.data.MODAL_REQUEST_TIMEOUT_SECONDS),
  VTON_BATCH_ENABLED: parsed.data.VTON_BATCH_ENABLED === 'true',
  VTON_BATCH_FLUSH_SIZE: Number(parsed.data.VTON_BATCH_FLUSH_SIZE),
  VTON_BATCH_MIN_FILL: Number(parsed.data.VTON_BATCH_MIN_FILL),
  VTON_BATCH_MAX_WAIT_SECONDS: Number(parsed.data.VTON_BATCH_MAX_WAIT_SECONDS),
  VTON_BATCH_SUBMIT_GRACE_SECONDS: Number(parsed.data.VTON_BATCH_SUBMIT_GRACE_SECONDS),
  VTON_BATCH_STALE_WARN_SECONDS: Number(parsed.data.VTON_BATCH_STALE_WARN_SECONDS),
  VTON_BATCH_FETCH_CONCURRENCY: Number(parsed.data.VTON_BATCH_FETCH_CONCURRENCY),
} as const;
