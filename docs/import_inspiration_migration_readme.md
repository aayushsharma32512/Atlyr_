# Inspiration Import Migration Reference

The feature is introduced by [`20260828233042_inspiration_imports.sql`](../supabase/migrations/20260828233042_inspiration_imports.sql), simplified by [`20260830194636_simplify_inspiration_import_schema.sql`](../supabase/migrations/20260830194636_simplify_inspiration_import_schema.sql), and aligned with selection staging and Studio drafts by [`20260904120000_link_inspiration_selections_to_outfits.sql`](../supabase/migrations/20260904120000_link_inspiration_selections_to_outfits.sql). Together they create four workflow tables and one private Storage bucket.

## Overall relationship

```text
auth.users
    │
    ├──< inspiration_imports
    │         │
    │         ├──< inspiration_import_candidates
    │         │          │
    │         │          ├──< inspiration_import_web_results
    │         │          │
    │         │          └──< inspiration_import_selections
    │         │                    ├── catalogue ──> products
    │         │                    ├── web ───────> web_results
    │         │                    └── outfit_id ──> private Studio outfit
    │
    └── Storage: inspiration-imports/<user-id>/<import-id>/...
```

The database stores workflow metadata and Storage paths. The actual images are stored in the private `inspiration-imports` bucket.

## 1. `inspiration_imports`

This is the parent/workflow record. One row represents one uploaded inspiration photo and its complete processing state.

| Column group | Columns | What it stores |
|---|---|---|
| Identity | `id`, `user_id` | Import ID and owning Supabase Auth user |
| Input | `source_kind`, `source_path`, `source_url` | Whether the import came from an image or URL and where the source is located |
| Workflow | `status` | Current step in the import workflow |
| Detection lease | `detection_attempt_id`, `detection_started_at`, `detector_job_id` | Prevents duplicate detector jobs and rejects stale callbacks |
| Failure | `error_code`, `error_message` | User-safe detection/workflow error |
| Lifecycle | `created_at`, `updated_at` | Creation and latest workflow transition; `updated_at` is the commit time for terminal committed imports |

### Status values

```text
created
  → source_ready
  → detecting
  → detected
  → candidate_selected
  → retrieving / ready
  → selections_staged  (when the final set contains a web result)
  → committed

Any processing step may also become:
  → failed
  → expired
```

Currently, not every declared state is actively used. For example, `retrieving` and `ready` provide room for the retrieval workflow, but the existing web-search handler does not currently transition through all of them.

### Constraints

| Constraint | Effect |
|---|---|
| `source_kind` | Only `image` or `url` |
| Image source | Requires `source_path` and forbids `source_url` |
| URL source | Requires `source_url` |
| User deletion | Deleting an `auth.users` row cascades to the import and its children |

An uncommitted import becomes eligible for cleanup 30 days after `created_at`. The migration intentionally creates no cleanup cron, so eligibility does not automatically delete anything yet.

## 2. `inspiration_import_candidates`

Stores every top or bottom detected in the source photo.

| Column group | Columns | What it stores |
|---|---|---|
| Identity | `id`, `import_id` | Candidate and parent import |
| Classification | `category`, `detector_label`, `confidence` | Normalized `top`/`bottom`, original label, confidence |
| Geometry | `bbox`, `box_source` | Normalized bounding box and how it was produced |
| Image | `retrieval_crop_path` | Storage path for the crop used by both the candidate preview and search |
| Diagnostics | `metrics` | FASHN/DINO measurements and debugging information |
| Selection | `selected_at` | Non-null when the user selected this garment |
| Audit | `created_at` | Creation time |

### Bounding box format

```json
{
  "l": 0.15,
  "t": 0.20,
  "w": 0.35,
  "h": 0.50
}
```

All values are normalized between `0` and `1`.

### Box source

| Value | Meaning |
|---|---|
| `fashn_union_dino` | Combined FASHN segmentation and Grounding DINO box |
| `fashn_only` | Candidate derived only from FASHN |
| `dino_only` | Candidate derived only from Grounding DINO |

A partial unique index on `(import_id, category)` ensures that an import can have at most one
selected top and one selected bottom.

The composite uniqueness on `(import_id, id)` allows child tables to enforce that a candidate belongs to the same import.

## 3. `inspiration_import_web_results`

Stores only Google Lens/SerpApi product results the user explicitly selected. Full search rails are
ephemeral, candidate-scoped browser cache entries with a one-hour TTL.

| Column group | Columns | What it stores |
|---|---|---|
| Identity | `id`, `import_id`, `candidate_id` | Result, import, and garment candidate |
| Provider | `provider`, `provider_result_id`, `rank` | SerpApi provider identity and result order |
| Product | `title`, `merchant_domain`, `listing_url`, `image_url` | Online listing information |
| Lifecycle | `created_at`, `expires_at` | Selection creation and the verified signed-result expiry |

`expires_at` remains the expiry carried by the signed search result. It must still be in the future
when the final choice is staged, but it does not make the persisted selection row temporary or
schedule its deletion.

Current provider is restricted to:

```text
serpapi_google_lens
```

The composite foreign key:

```text
(import_id, candidate_id)
    → inspiration_import_candidates(import_id, id)
```

prevents attaching a result to a candidate from another import.

The Edge Function signs ephemeral one-hour result payloads. Card selection remains in browser
memory/storage. Its service-only staging RPC verifies the chosen tokens and atomically inserts only
the final one-per-candidate set when the user saves the selections.

## 4. `inspiration_import_selections`

Records what the user ultimately chose to add.

| Column group | Columns | What it stores |
|---|---|---|
| Identity | `id`, `import_id`, `candidate_id` | Selection and selected garment |
| Source | `source` | `catalogue` or `web` |
| Catalogue item | `product_id` | Existing `products.id` |
| Web item | `web_result_id` | Selected online result |
| Progress | `status` | Current selection state |
| Reserved | `ingestion_job_id`, `ingested_product_id` | Existing nullable schema fields; unused by this delivery |
| Studio draft | `outfit_id` | Private `outfits.id` containing the final selection |
| Audit | `created_at`, `updated_at` | Selection timestamps |

### Source shape

| Source | Required | Must be empty |
|---|---|---|
| `catalogue` | `product_id` | `web_result_id` |
| `web` | `web_result_id` | `product_id` |

### Selection statuses

| Status | Meaning |
|---|---|
| `opened_in_studio` | Final inventory product opened in the linked draft |
| `selected_for_outfit` | Catalogue product staged while selected web products await ingestion |
| `selected_for_ingestion` | Web result selected, but ingestion not started |
| `queued`, `ingesting`, `ingested`, `failed` | Existing reserved values; not written by this delivery |

Lens click state is browser-only. The staging action atomically writes catalogue rows as
`selected_for_outfit` and web rows as `selected_for_ingestion`. Job-related states are reserved for
the later ingestion-service integration.

### Uniqueness rules

| Rule | Effect |
|---|---|
| `(import_id, product_id)` for catalogue rows | Same catalogue product cannot be selected twice in an import |
| One non-failed web selection per import/candidate | User can select at most one active web result for each top or bottom |

## Existing tables affected

The Studio finalization RPC validates and links existing product and outfit rows.

| Existing table | Interaction |
|---|---|
| `auth.users` | Owns imports |
| `products` | Validates catalogue IDs and ensures their `type` matches the selected `top`/`bottom` |
| `outfits` | Owns the private Studio draft referenced by the import and each final selection |

Favorite and Wardrobe membership remain independent UI actions backed by `user_favorites`; opening
an inspiration selection in Studio does not add it to either collection.

## RPC functions

All RPCs are `SECURITY DEFINER`, so they can modify private workflow tables. User-facing functions explicitly call `auth.uid()` and verify import ownership.

| RPC | Allowed role | Purpose and side effects |
|---|---|---|
| `begin_inspiration_detection` | `authenticated` | Locks import, creates attempt ID, sets `detecting`; returns existing attempt if lease is active |
| `set_inspiration_detector_job` | `authenticated` | Saves Modal's job ID only if attempt/import still matches |
| `select_inspiration_candidates` | `authenticated` | Atomically confirms one or two candidates, with at most one per category, and removes results outside the confirmed set |
| `stage_inspiration_import_selections` | `service_role` only | Atomically persists the complete final catalogue/web selection set for later ingestion |
| `open_inspiration_import_in_studio` | `authenticated` | Validates inventory product IDs, records provenance, and links the private Studio draft |
| `finalize_inspiration_detection` | `service_role` only | Modal callback finalizer; atomically saves candidates or records detector failure |

`finalize_inspiration_detection` is intentionally different:

- It does not depend on `auth.uid()`.
- Only `service_role` can execute it.
- It checks `detection_attempt_id`.
- A stale callback returns `false` without changing the import.
- It accepts at most 12 candidates.

## Role and access matrix

All four workflow tables have RLS enabled, but they intentionally have no user-facing table policies.

| Resource | `anon` | `authenticated` | `service_role` |
|---|---:|---:|---:|
| `inspiration_imports` direct table access | None | None | Select, insert, update, delete |
| `inspiration_import_candidates` | None | None | Select only |
| `inspiration_import_web_results` | None | None | Select, insert, delete |
| `inspiration_import_selections` | None | None | Select only |
| User-facing RPCs | None | Execute | Not explicitly granted |
| Detection finalizer RPC | None | None | Execute |
| Source image upload | None | Own folder only | Full administrative access |
| Image reads | None | Signed URLs only | Administrative access |

This means the frontend cannot query or modify these tables directly. It must go through the `inspiration-import` Edge Function.

The explicit `service_role` grants account for Supabase's move toward not automatically exposing newly created public tables to the Data API. See the [Supabase Data API exposure changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Storage bucket

### Bucket configuration

| Setting | Value |
|---|---|
| Bucket ID/name | `inspiration-imports` |
| Public | `false` |
| Maximum object size | 10 MB |
| Accepted MIME types | JPEG, PNG, WebP |
| Direct browser upload | Only original source image |
| Direct browser read | Not allowed |
| Candidate crop upload | Edge callback using service role |
| Reads shown in frontend | Short-lived signed URLs |
| Automatic cleanup | Not currently configured |

### Object layout

```text
inspiration-imports/
└── <user-id>/
    └── <import-id>/
        ├── source/
        │   └── original.jpg | original.png | original.webp
        │
        └── candidates/
            └── <candidate-id>/
                └── retrieval.webp
```

| File | Purpose |
|---|---|
| `source/original.*` | Original user-uploaded inspiration photo |
| `retrieval.webp` | Processed crop shown in candidate selection and sent to catalogue search or Google Lens |

The simplify migration drops the obsolete `display_crop_path` column. It does not delete any
previously uploaded `display.webp` objects; those remain unreferenced until a separate, explicitly
approved Storage cleanup is performed.

### Bucket upload policy

The only Storage policy created by this migration is:

```text
Users upload own inspiration source
```

It allows an authenticated user to insert an object only when:

| Check | Required value |
|---|---|
| Bucket | `inspiration-imports` |
| First path folder | Current `auth.uid()` |
| Third path folder | `source` |
| Filename | Starts with `original.` |

Therefore the browser can upload:

```text
<current-user-id>/<some-import-id>/source/original.jpg
```

but cannot upload:

```text
another-user-id/.../source/original.jpg
<current-user-id>/.../candidates/.../retrieval.webp
```

The second folder is not independently validated by the Storage policy as an actual import ID. However, the Edge Function creates and returns the exact expected path, and `source-ready` verifies that the uploaded object exists at the path stored in the owned import row.

### Bucket reads and deletion

There is no authenticated `SELECT`, `UPDATE`, or `DELETE` Storage policy in this migration.

Consequently:

- Images are read through signed URLs created by the Edge Function.
- Candidate crops are uploaded by the callback's service-role client.
- Import deletion is handled by the Edge Function:
  1. Delete source and crop objects from Storage.
  2. Delete the parent `inspiration_imports` row.
  3. Database cascades remove candidates, results, and selections.

Deleting only the database row would not delete Storage objects because Storage paths are not foreign keys.

## Important current limitations

- Import cleanup eligibility is derived from `created_at`; it does not automatically clean up imports or images.
- No cron, Vault, `pg_net`, or cleanup function is installed.
- URL imports are modeled in the table, but the current Edge Function creates image imports only.
- Ingestion execution and automatic Studio-outfit creation are intentionally deferred; the database
  contains the complete staged selection set for the future ingestion worker to read.
- Changing or manually cropping a source creates a new immutable import rather than versioning an existing import.
- The schema does not currently enforce per-user daily detector or Lens quotas; add Edge-level cost controls before a broad launch if required.
