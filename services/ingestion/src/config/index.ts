import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  DATABASE_URL_DIRECT: z.string().url(),

  BOSS_SCHEMA: z.string().default('boss'),
  BOSS_ARCHIVE_AFTER: z.string().default('PT24H'),
  BOSS_RESTART_MAX_ATTEMPTS: z.string().default('5'),
  BOSS_RESTART_BASE_MS: z.string().default('1000'),
  BOSS_RESTART_MAX_MS: z.string().default('15000'),

  STORAGE_BUCKET: z.string().default('ingested_inventory'),
  RAW_PREFIX: z.string().default('raw'),
  GHOST_PREFIX: z.string().default('ghost'),
  STAGING_GM_PREFIX: z.string().default('staging/ghost_mannequins'),
  PROCESSED_GM_PREFIX: z.string().default('processed/ghost_mannequins'),
  PROCESSED_PRODUCT_PREFIX: z.string().default('processed/product_images'),
  STORAGE_PUBLIC_URLS: z.string().default('true'),

  FIRECRAWL_API_KEY: z.string().min(1),
  GOOGLE_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),

  PIPELINE_VERSION: z.string().default('1'),
  IMAGE_MAX_WIDTH: z.string().default('2048'),
  IMAGE_MAX_HEIGHT: z.string().default('2048'),
  NANO_BANANA_TIMEOUT_S: z.string().default('120'),
  NANO_BANANA_API_URL: z.string().url().optional(),
  NANO_BANANA_API_KEY: z.string().min(1).optional(),
  GHOST_AVATAR_REFERENCE_PATH: z.string().default('avatars/bodytypes/bt1.png'),

  LLM_PRIMARY: z.enum(['gemini', 'openai']).default('gemini'),
  LLM_FALLBACK: z.enum(['gemini', 'openai']).default('openai'),
  LLM_JSON_STRICT: z.string().default('true'),
  LLM_RETRY_LIMIT: z.string().default('3'),
  LLM_RETRY_BASE_MS: z.string().default('1000'),
  LLM_RETRY_MAX_MS: z.string().default('10000'),

  MAX_CONCURRENCY_GLOBAL: z.string().default('8'),
  MAX_CONCURRENCY_PER_DOMAIN: z.string().default('2'),

  ENABLE_PLAYWRIGHT_FALLBACK: z.string().default('true'),
  ENABLE_MULTIMODAL_ENRICHMENT: z.string().default('true'),
  ENABLE_YOLO_CORROBORATION: z.string().default('false'),
  ENABLE_GHOST_BACK_VIEW: z.string().default('false'),

  // mode
  FIRECRAWL_MODE: z.enum(['scrape', 'extract']).default('scrape'),
  FIRECRAWL_MAX_CONCURRENCY: z.string().default('5'),

  // scrape defaults
  FIRECRAWL_SCRAPE_API_VERSION: z.enum(['v1', 'v2']).default('v2'),
  // When true, scrape the full page (Firecrawl v2: onlyMainContent=false).
  FIRECRAWL_SCRAPE_FULL_PAGE: z.string().default('false'),
  // When true, request raw HTML (best-effort; may be ignored depending on Firecrawl API behavior).
  FIRECRAWL_SCRAPE_INCLUDE_RAW_HTML: z.string().default('false'),
  // Advanced v2 scrape options (commented out for "basic migration" phase):
  // - FIRECRAWL_SCRAPE_INCLUDE_LINKS
  // - FIRECRAWL_SCRAPE_INCLUDE_RAW_HTML
  // - FIRECRAWL_SCRAPE_ONLY_MAIN_CONTENT
  // - FIRECRAWL_SCRAPE_WAIT_FOR_MS
  // - FIRECRAWL_SCRAPE_MAX_AGE_MS
  // - FIRECRAWL_SCRAPE_BLOCK_ADS
  // - FIRECRAWL_SCRAPE_REMOVE_BASE64_IMAGES
  // - FIRECRAWL_SCRAPE_SKIP_TLS_VERIFICATION
  // - FIRECRAWL_SCRAPE_MOBILE
  // - FIRECRAWL_PROXY_MODE / FIRECRAWL_PROXY_COUNTRY / FIRECRAWL_PROXY_LANGUAGES
  // - FIRECRAWL_RETRY_* and FIRECRAWL_LOW_IMAGECOUNT_RETRY_THRESHOLD

  SCRAPE_INCLUDE_HTML: z.string().default('true'),
  SCRAPE_ACTIONS_STRATEGY: z.enum(['none', 'minimal', 'generic']).default('minimal'),
  SCRAPE_WAIT_MS: z.string().default('1000'),
  SCRAPE_TIMEOUT_MS: z.string().default('120000'),
  SCRAPE_JSON_BASICS_PROMPT: z.string().default('You are extracting structured data from a single product PDP (product detail page). Extract brand, product_name, price_minor (smallest unit), currency (ISO), gender, color, raw_description, material, care, product_specifications, fit, feel, size_chart, and an images array.\n\nIMAGES REQUIREMENTS (critical):\n- Return ONLY images for the PRIMARY product shown on this PDP URL.\n- EXCLUDE any images from recommendations, cross-sell sections (for example "Customers also liked"), product lists, ads, header/footer icons, logos, sprites, trackers.\n- Prefer high-resolution product images. If both thumbnails and larger variants exist, choose the largest available (avoid tiny sizes like h_150/w_112).\n- Prefer and include PDP meta/social images when they represent the primary product (og:image, twitter:image) and/or any embedded product state JSON that contains the gallery.\n- Return ALL distinct gallery images (front/back/side/detail) when present. Deduplicate by URL.\n- Order images in natural gallery order with the primary hero image first.\n\nOutput format for images: an array of objects { url, kind?, is_primary_suggestion?, sort_order_suggestion? }. Set is_primary_suggestion=true for the first image and provide a monotonically increasing sort_order_suggestion.\n\nSize chart and product specification content may appear in Fit, Product Description, Size Guide, or similar sections; capture structured text or tabular data and set an empty object when absent. Use only on-page content and set fields to null when a value is missing.'),

  // extract options
  EXTRACT_ACTIONS_STRATEGY: z.enum(['none', 'minimal', 'generic']).default('generic'),
  EXTRACT_MAX_CLICKS: z.string().default('8'),
  EXTRACT_WAIT_MS: z.string().default('1500'),
  EXTRACT_PROMPT_VERSION: z.string().default('v1'),
  FIRECRAWL_EXTRACT_ENABLE_WEB_SEARCH: z.string().default('false'),
  FIRECRAWL_EXTRACT_USE_AGENT: z.string().default('true'),
  FIRECRAWL_EXTRACT_AGENT_MODEL: z.string().default('FIRE-1'),
  FIRECRAWL_EXTRACT_POLL_INTERVAL_MS: z.string().default('3000'),
  FIRECRAWL_EXTRACT_POLL_TIMEOUT_MS: z.string().default('180000'),

  // debug flag
  DEBUG_FIRECRAWL: z.string().default('true'),

  HITL_OPERATOR_TOKEN: z.string().min(1).default('local-operator-token')
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten());
  process.exit(1);
}

if (parsed.data.STORAGE_BUCKET.trim().toLowerCase() === 'public') {
  console.error('STORAGE_BUCKET cannot be "public". Rename the bucket to "ingested_inventory" (or set STORAGE_BUCKET accordingly).');
  process.exit(1);
}

export const config = {
  ...parsed.data,
  STORAGE_PUBLIC_URLS: parsed.data.STORAGE_PUBLIC_URLS === 'true',
  LLM_JSON_STRICT: parsed.data.LLM_JSON_STRICT === 'true',
  ENABLE_GHOST_BACK_VIEW: parsed.data.ENABLE_GHOST_BACK_VIEW === 'true',
  MAX_CONCURRENCY_GLOBAL: Number(parsed.data.MAX_CONCURRENCY_GLOBAL),
  MAX_CONCURRENCY_PER_DOMAIN: Number(parsed.data.MAX_CONCURRENCY_PER_DOMAIN),
  IMAGE_MAX_WIDTH: Number(parsed.data.IMAGE_MAX_WIDTH),
  IMAGE_MAX_HEIGHT: Number(parsed.data.IMAGE_MAX_HEIGHT),
  NANO_BANANA_TIMEOUT_S: Number(parsed.data.NANO_BANANA_TIMEOUT_S),
  EXTRACT_MAX_CLICKS: Number(parsed.data.EXTRACT_MAX_CLICKS),
  EXTRACT_WAIT_MS: Number(parsed.data.EXTRACT_WAIT_MS),
  FIRECRAWL_EXTRACT_POLL_INTERVAL_MS: Number(parsed.data.FIRECRAWL_EXTRACT_POLL_INTERVAL_MS),
  FIRECRAWL_EXTRACT_POLL_TIMEOUT_MS: Number(parsed.data.FIRECRAWL_EXTRACT_POLL_TIMEOUT_MS),
  FIRECRAWL_SCRAPE_FULL_PAGE: parsed.data.FIRECRAWL_SCRAPE_FULL_PAGE === 'true',
  FIRECRAWL_SCRAPE_INCLUDE_RAW_HTML: parsed.data.FIRECRAWL_SCRAPE_INCLUDE_RAW_HTML === 'true',
  SCRAPE_WAIT_MS: Number(parsed.data.SCRAPE_WAIT_MS),
  SCRAPE_TIMEOUT_MS: Number(parsed.data.SCRAPE_TIMEOUT_MS),
  FIRECRAWL_MAX_CONCURRENCY: Number(parsed.data.FIRECRAWL_MAX_CONCURRENCY),
  BOSS_RESTART_MAX_ATTEMPTS: Number(parsed.data.BOSS_RESTART_MAX_ATTEMPTS),
  BOSS_RESTART_BASE_MS: Number(parsed.data.BOSS_RESTART_BASE_MS),
  BOSS_RESTART_MAX_MS: Number(parsed.data.BOSS_RESTART_MAX_MS),
  LLM_RETRY_LIMIT: Number(parsed.data.LLM_RETRY_LIMIT),
  LLM_RETRY_BASE_MS: Number(parsed.data.LLM_RETRY_BASE_MS),
  LLM_RETRY_MAX_MS: Number(parsed.data.LLM_RETRY_MAX_MS)
} as const;
