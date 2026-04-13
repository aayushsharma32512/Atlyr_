Dev Setup Guide

This is a Vite + React + TypeScript SPA backed by Supabase (Auth, Postgres, Storage). UI uses Tailwind and shadcn/ui. Scripts use Bun for data ingestion.

### Tech stack
- Vite + React + TS
- Tailwind + shadcn/ui
- Supabase (Postgres, Auth, Storage)
- Bun (for data scripts)

### Prerequisites
- Bun (required): https://bun.sh/docs/install
- Node.js 20+ (optional, for tooling)
- Git
- Supabase account
- Optional: Supabase CLI (for local DB or applying migrations): https://supabase.com/docs/guides/cli

### 1) Clone the repo
```bash
git clone <YOUR_GIT_URL>
cd query-your-helper
```

### 2) Install dependencies (Bun)
```bash
bun install
```

### 3) Configure Supabase credentials
Create a `.env.local` file in the repo root with your client credentials (Vite expects VITE_ prefix):
```bash
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```
Notes:
- For local Supabase (via CLI), set `VITE_SUPABASE_URL` to the local URL shown by `supabase start` and use the local anon key from the CLI output.
- The file `src/integrations/supabase/client.ts` supports these vars; do not hardcode keys in code.

### 4) Database migrations (pgvector + schema)
You can run locally with Supabase CLI, or apply to your hosted project.

Option A — Local (recommended for development)
```bash
# Install and login once
supabase --version
supabase start

# Apply migrations in this repo to the local Postgres
supabase db reset   # or: supabase db push
```

Option B — Hosted project (production/staging)
```bash
# Link your project (one-time)
supabase link --project-ref <project-ref>

# Push migrations to the linked database
supabase db push
```
What migrations do:
- Enable pgvector (semantic search)
- Create/alter core tables (`products`, `outfits`, etc.)
- Add vector embedding columns for AI-powered semantic search

### 5) Vector Search Setup (Optional)
Enable AI-powered semantic search using OpenAI embeddings:

```bash
# Install OpenAI dependency
bun add openai

# Set up environment variables (see VECTOR_SEARCH_SETUP.md)
# Add OPENAI_API_KEY and SUPABASE_SERVICE_ROLE_KEY to .env.local

# Generate embeddings for existing data
bun run generate:embeddings

# Start the app and test semantic search
bun run dev
```

See `VECTOR_SEARCH_SETUP.md` for detailed setup instructions.

### 6) Run the web app (dev)
```bash
bun run dev

# Open
http://localhost:8080
```

### 7) Optional: Product upload scripts
These scripts upload images to Supabase Storage and insert products.

Setup env for scripts (service role key required):
```bash
# creates/validates .env for scripts
bun run upload:setup

# then edit .env with:
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```
Run uploads:
```bash
# Upload images + insert products (see scripts/README.md for details)
bun run upload:products
```
See `scripts/README.md` for the expected Excel format and behavior.

### 8) Linting
```bash
bun run lint
```

### Project structure (high level)
- `src/` — React app code (pages, components, hooks)
- `src/integrations/supabase/` — Supabase client and types
- `supabase/` — Migrations and config
- `scripts/` — Data ingestion and embedding generation scripts
- `VECTOR_SEARCH_SETUP.md` — Detailed guide for AI-powered semantic search
- `public/` — Static assets
- `scripts/` — Data ingestion utilities (run with Bun)

### Environment tips
- Client-side code uses the anon key only. Keep service role keys out of the browser. Scripts run server-side with the service role key.
- Vite env files: `.env.local` is ignored by Git and used for local dev.

### Troubleshooting
- Supabase auth/storage errors: ensure the correct URL and anon key in `.env.local`.
- 404s or empty data: verify your migrations ran and you inserted data (via scripts or Supabase Studio).
- Port conflicts: Vite serves on 8080 (see `vite.config.ts`). Change if needed.

### Deploying
This is a static SPA and can be deployed to any static host (Vercel/Netlify/Cloudflare Pages). Build and deploy the `dist/` folder:
```bash
bun run build
bun run preview  # local preview
```
For GitHub Pages, a `deploy` script exists but may require setup of the repo’s Pages branch.

### Roadmap (semantic search)
- pgvector is enabled via migrations.
- Text-only embeddings (OpenAI) for `outfits` and `products` are planned via Edge Functions and server endpoints.
- Fashion-CLIP (image) search will be layered later; storage and indexes remain in Postgres.

---
If you hit setup issues, open an issue with your OS, Node/Bun versions, and console logs.
