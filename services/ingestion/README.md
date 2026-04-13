# Ingestion Service

Node.js/TypeScript service for brand-agnostic product ingestion. Provides API endpoints, pg-boss queues, and workflow orchestration.

## Prerequisites
- Node 20+
- Supabase project (direct Postgres access on port 5432)
- .env in this folder with required keys (see below)

## Environment (.env)
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- DATABASE_URL_DIRECT (direct Postgres URL, not PgBouncer)
- BOSS_SCHEMA=boss, BOSS_ARCHIVE_AFTER=PT24H, BOSS_EXPIRE_AFTER=P14D
- Storage prefixes: RAW_PREFIX, GHOST_PREFIX, PROCESSED_GM_PREFIX, PROCESSED_PRODUCT_PREFIX
- FIRECRAWL_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY

## Install & Run
```
bun install # or npm install
bun run dev  # or npm run dev
```
The service should log `Environment validated` and `pg-boss started` and expose GET /health.

## Verify pg-boss
- On first run, pg-boss creates tables in the `boss` schema.
- Use Supabase SQL editor to check tables (boss.job, boss.archive, boss.schedule).
