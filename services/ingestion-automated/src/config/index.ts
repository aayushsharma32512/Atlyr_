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

  GOOGLE_API_KEY: optStr,
  GEMINI_TEXT_MODEL: z.string().default('gemini-1.5-pro'),
  SIGLIP_ENDPOINT: optUrl,
  SIGLIP_API_KEY: optStr,

  FASHN_VTON_API_URL: optUrl,
  FASHN_VTON_API_KEY: optStr,
  SEEDREAM_API_URL: optUrl,
  SEEDREAM_API_KEY: optStr,
  GEMINI_NANO_BANANA_API_URL: optUrl,
  GEMINI_NANO_BANANA_API_KEY: optStr,

  FASHN_SEG_API_URL: optUrl,
  SCHP_SEG_API_URL: optUrl,
  GDINO_API_URL: optUrl,
  SAM_V2_API_URL: optUrl,
  FASHN_SEG_REFINE_API_URL: optUrl,
  VITMATTE_API_URL: optUrl,
  BIREFNET_API_URL: optUrl,

  BOSS_SCHEMA: z.string().default('pgboss_ingestion_v2'),
  BOSS_TEAM_SIZE: z.string().default('5'),
  BOSS_EXPIRE_AFTER: z.string().default('PT2H'),
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
  BOSS_RESTART_BASE_MS: Number(parsed.data.BOSS_RESTART_BASE_MS),
  BOSS_RESTART_MAX_MS: Number(parsed.data.BOSS_RESTART_MAX_MS),
  BOSS_RESTART_MAX_ATTEMPTS: Number(parsed.data.BOSS_RESTART_MAX_ATTEMPTS),
  FIRECRAWL_MAX_CONCURRENCY: Number(parsed.data.FIRECRAWL_MAX_CONCURRENCY),
} as const;
