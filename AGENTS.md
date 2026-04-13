# Repository Guidelines

## Project Structure & Modules
- `src/` React+TS SPA (pages, components, hooks, design-system, Supabase integrations); `public/` static assets.
- `services/ingestion/src/` Bun/Node ingestion service (API, queues, orchestration, ghost prompt config).
- `scripts/` Bun utilities for uploads/embeddings/tests; see `scripts/README.md`. `supabase/` holds SQL migrations and pgvector setup.
- Reference docs: `README.md`, `Architecture.md`, `VECTOR_SEARCH_SETUP.md`, `docs/`.

## Build, Test, Development
- Install: `bun install` (root; service uses its own `bun install` inside `services/ingestion`).
- App: `bun run dev` (Vite 8080), `bun run build`, `bun run preview`.
- Lint: `bun run lint` (ESLint via `eslint.config.js`).
- Data/ops scripts: `bun run upload:setup`, `bun run upload:products`, `bun run generate:embeddings`, `bun run test:search` (env keys required).
- Ingestion service: from `services/ingestion`, `bun run dev` (needs `.env` with Supabase/Postgres keys).

## Coding Style & Naming
- TypeScript-first; React functional components with hooks. 2-space indent, `PascalCase` components/files, `camelCase` vars/functions.
- Order imports: external then relative; prefer named exports and colocated types (`type` over `interface` when practical).
- Tailwind + shadcn/ui: reuse design-system primitives; keep class lists lean. No secrets in code—use `.env.local` (`VITE_` prefix) and service `.env`.
- Outfit inspiration rendering: use presets that include the canonical render box from `src/features/studio/constants/renderBox.ts`; do not set `renderBox` at call sites when adding `OutfitInspirationCard`/`OutfitInspirationTile`.

## Testing
- Jest for unit tests; run `bunx jest` or target files (e.g., `bunx jest src/utils/avatarPlacement.test.ts`).
- Vector search checks: `bun run test:search` (hits Supabase + embeddings).
- Add/extend tests for new services/hooks; mock Supabase/AI clients instead of live calls.

## Frontend-Backend Integration Rules
- Flow: Supabase → domain service modules → TanStack Query hooks → screen components. Screens never touch Supabase directly.
- Domain services (`src/services/<domain>`) own all Supabase/RPC/edge calls and data shaping.
- Query key factories in `src/features/<domain>/queryKeys.ts` feed every `useQuery`/`useMutation`; caching/invalidation must use these helpers.
- Hooks in `src/features/<domain>/hooks` wrap services, set `staleTime/gcTime/select`, and house side-effects/mutations.
- Screens stay declarative: consume hooks, render design-system primitives, avoid business logic and ad-hoc fetches.
- Use prefetching/parallel queries to avoid waterfalls (e.g., `queryClient.prefetchQuery`, `useSuspenseQueries`). New Supabase access requires service+hook updates and tests (e.g., `renderHook` with `QueryClientProvider`). Place new work in the new architecture folders; legacy dirs are reference-only.

## PostHog Tracking Rules (Must Follow Spec)
- Source of truth: `docs/posthog/ENGAGEMENT_TRACKING_SPEC.md`. If tracking behavior changes, update the spec first (or in the same PR).
- No ad-hoc calls: screens/components must not call `posthog.capture/identify/reset` directly. All tracking goes through a single analytics facade + domain helpers.
- Production gating only: capture only on production hostnames and allowed routes; autocapture stays off; session replay is opt-in and must respect the same gating.
- Canonical primitives: every event includes `session_id` + `surface` (injected by the facade). Only `screen_entered` and `search_submitted` emit `entry_surface`.
- Surface semantics: “surface change” means computed `surface` changed (not URL/query-param-only changes). Ordering on surface exit is locked: flush `items_seen_summary` → emit `screen_duration` → emit next `screen_entered`.
- Session semantics: `session_id` stored in `sessionStorage` and rotates only after hidden > 30 minutes then visible; implement the session rotation anchor behavior from the spec.
- Locked vocabularies: do not invent new values for locked fields (`surface`, `section`, `layout`, `search_trigger`, operators, etc.). Omit `section` unless it’s a locked value.
- Search contract: use the shared canonical serializer for `filters`/`sort`; mint new `search_id` only at commit points; on dataset reset, flush summaries before resetting.
- Browse depth contract: `items_seen_summary` must follow the spec (seen rule, dedupe, triggers, ordering, flush/reset paths) and be implemented via one shared impressions manager.
- PII: email allowed only as a person property via `identify()`. Never include invite codes in event properties. `query_raw` is allowed per spec; do not add other PII.
- Auth identity: identify on auth success and reset on logout; rotate `session_id` on logout to avoid cross-user journeys on shared devices.

## New Architecture Folders (Source of Truth)
- `src/services/<domain>` — Supabase/RPC/edge calls + data transforms.
- `src/features/<domain>/queryKeys.ts` — query key factory per domain.
- `src/features/<domain>/hooks` — TanStack Query hooks wrapping services.
- `src/features/<domain>/providers` (e.g., `src/features/profile/providers`) — contexts fed by the new hooks.
- `src/design-system` — shared UI primitives; prefer reusing here instead of creating ad-hoc components elsewhere.
- `services/ingestion/src` — inventory/ghost ingestion service (API, queues, orchestration); keep ingestion logic here, not in the SPA.
- All screens pull from these layers; do not add new code to legacy folders except shared utilities.

## Commit & PR Guidelines
- Commits: short, present-tense, imperative (`add view prompts`, `fix inventory popups`).
- PRs: summary, linked issue/task, risks (migrations/env changes), commands/tests run; include screenshots/GIFs for UI changes.
- Keep diffs scoped; update docs when behavior or setup changes.
