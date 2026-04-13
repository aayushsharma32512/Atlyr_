# PostHog Engagement Tracking Spec (New App)

Canonical spec for engagement tracking in PostHog for Atlyr’s **new app** (not legacy `/app`).

**Design goal:** journeys and key product metrics are reconstructable **purely from the event stream**. We use exactly one summary-style event family where necessary: `items_seen_summary`.

This spec is written to be followed **step-by-step** when implementing tracking.

---

## 0) Scope + non‑negotiables (locked)

### 0.1 In scope
- New app: `/home`, `/search`, `/collection`, `/profile`, `/studio/*`
- Auth funnel: `/auth/login`, `/auth/signup`, `/auth/callback`
- Landing (waitlist entry): `surface=landing`

### 0.2 Out of scope
- Legacy app: `/app/*`
- Non-product: `/admin/*`, `/hitl/*`, `/design-system/*`, `/mannequin/*`

### 0.3 Environment gating
- Track only on production hostnames (per route policy).
- Autocapture stays **off**.

### 0.4 PII policy
- Email is allowed as a PostHog **person property** via `identify()`.
- Invite code is **not** included in event properties.
- Search stores `query_raw` as-is (high-cardinality; potential PII vector by nature).

---

## 1) Core model (locked)

### 1.1 Active time
Active time is counted only when:
- `document.visibilityState === "visible"`

When hidden, timers pause.

### 1.2 Sessionization (`session_id`)
- `session_id` is stored in `sessionStorage`.
- A new `session_id` starts when the tab becomes visible and it has been hidden for **> 30 minutes**.
- No “visible-idle” splitting.

Session start is derived (no separate session-start event):
- `t(session_start) = min(t(screen_entered))` for a given `session_id`.

### 1.3 Returning device (`is_returning_device`)
`is_returning_device` is a boolean computed client-side:
- `false` on the first-ever tracked visit on this browser/profile
- `true` on subsequent visits

Implementation expectation:
- Persist a simple “has visited before” flag in `localStorage`.

### 1.4 `surface` + “surface change”
`surface` is the canonical screen identifier used for journey reconstruction.

Locked rule:
- A “surface change” is a change in the computed `surface` value (not merely a URL/query param change).
- Query-param-only changes must **not** emit `screen_entered`/`screen_duration` unless they change the computed `surface`.

### 1.5 Navigation attribution (`entry_surface`)
- `entry_surface` = the immediately previous `surface` within the app.
- The first surface in a session uses `entry_surface="unknown"`.

Locked emission rule:
- `entry_surface` is emitted only on:
  - `screen_entered`
  - `search_submitted`
All other events rely on `surface` and can be attributed by joining to the latest `screen_entered` within the same `session_id`.

### 1.6 Studio session time boundaries
Studio session time includes only:
- `studio_main`
- `studio_alternatives`
- `studio_scroll_up`
- `studio_likeness`

These are excluded from Studio session time, but tracked individually via timing:
- `studio_product_page`
- `studio_similar`
- `studio_outfit_suggestions`

### 1.7 Collections + profile (phase 1)
`/collection` and `/profile` are **timing-only** for now (journey + time via `screen_entered` / `screen_duration`), with no extra interaction events beyond shared primitives (clicks/saves/buys).

---

## 2) Vocabulary (properties we standardize)

### 2.1 Common properties
Most events include:
- `session_id`
- `surface`

Some events additionally include:
- `entry_surface` (only `screen_entered`, `search_submitted`)

### 2.2 Unified entity fields
Used by `item_clicked`, `save_toggled`, `saved_to_collection`, `product_buy_clicked`, and also as stable identity for `items_seen_summary`:
- `entity_type`: `outfit | product`
- `entity_id`: the corresponding entity id

### 2.3 `surface` (locked values)
Landing + auth:
- `landing`
- `auth_login`
- `auth_signup`
- `auth_callback`

Main tabs:
- `home_feed`
- `home_moodboard` (use `moodboard_slug`)
- `search_results`
- `collections_moodboards`
- `collections_creations`
- `collections_products`
- `profile`

Studio session surfaces (counted in Studio session time):
- `studio_main` (`/studio`)
- `studio_alternatives` (`/studio/alternatives`)
- `studio_scroll_up` (`/studio/scroll-up`)
- `studio_likeness` (`/studio/likeness`)

Studio non-session surfaces (timed individually; excluded from Studio session time):
- `studio_product_page` (`/studio/product/:productId`)
- `studio_similar` (`/studio/similar`)
- `studio_outfit_suggestions` (`/studio/outfit-suggestions`)

### 2.4 `section` (optional; locked values only)
`section` is optional. Only send it when it materially improves analysis.

Important: `section` is **not** used to represent Home “moodboard tabs” (system or user-created). Home tab identity is represented by `moodboard_slug` (see `screen_entered(surface=home_moodboard)` and `moodboard_selected`).

Do **not** invent new `section` strings ad hoc—omit the property unless it’s one of these locked values:
- Home: `recent`, `curated`
- Studio main: `product_tray`
- Studio similar: `pair_with_wardrobe`, `pair_with_new_items`, `popular_styles`
- Collections: `moodboards_list`, `creations_carousel`, `saved_products_grid`

### 2.5 `layout` + `position` (locked)
- `layout`: `vertical_grid | horizontal_rail | carousel`
- `position`: 0-based index within the list/rail at interaction time

`position` ordering rules (locked):
- `vertical_grid`: row-major, top-left to bottom-right as rendered
- `horizontal_rail`: left-to-right as rendered
- `carousel`: left-to-right as rendered

### 2.6 Landing attribution fields (UTM + referrer)
When `surface=landing`, `screen_entered` captures attribution fields on **every landing entry**:
- `utm_*`: capture all present UTM params from the URL (do not invent absent keys)
- `referrer`: use `document.referrer`
- `landing_path`: landing pathname **only** (exclude query params)
- `is_returning_device`

For downstream attribution (e.g., `waitlist_submitted`), implementation should reuse the most recent landing attribution observed within the current session when applicable.

### 2.7 Search vocabulary (flexible keys, canonical encoding)
- `search_id`: unique id per **search results set** (each user action that refreshes results should mint a new `search_id`)
- `search_type`: `text | image | both`
- `mode`: `outfits | products`
- `search_trigger`: why a new results set was generated
  - locked values: `query_submit | filters_apply | sort_change | mode_change`

We do **not** lock a static list of filter keys because they differ across screens and will evolve. Instead we lock a canonical encoding so the same logical state always serializes identically.

### 2.8 Canonicalization rules (inputs)
Some app state can arrive via old deep links/bookmarks (even in the “new app”). To keep analytics clean:
- For Home moodboards, treat `moodboard_slug=generations` as an alias of `try-ons` and **canonicalize to `try-ons`** before emitting events.

Canonical `filters` shape (locked):
- `filters: Array<{ key: string, operator: string, value: unknown }>`

Operator set (locked; keep small and consistent):
- `eq | in | gte | lte | between | contains | exists`

Normalization rules (locked):
- Sort clauses by `key`, then `operator`, then `value` (stable-stringified) to keep ordering deterministic.
- For multi-select values, `value` must be an array and must be sorted.
- For range filters:
  - `operator=between`
  - `value: { min?: number, max?: number }` (omit missing bounds rather than using nulls)

Stable stringification rule (locked):
- All canonicalization uses a single shared stable serializer (deterministic JSON with sorted object keys, no whitespace differences).
- This same serializer must be used for:
  - `search_submitted.filters/sort`
  - `studio_combination_viewed` alternatives search context when `results_mode=search`

Canonical `sort` shape (locked):
- `sort: string` (screen-specific keys allowed)

If a screen has sort direction, encode it into the identifier (e.g., `price_low_to_high`) rather than sending separate direction fields.

Empty-state rules (locked):
- If there are no active filters, emit `filters=[]` (do not omit the field).
- If there is no explicit sort selected, emit `sort="default"` (do not omit the field).

### 2.8 Browse container vocabulary (for `items_seen_summary`)
- `container_type`: `screen | rail`
- `rail_id`: required when `container_type=rail`
  - recommended format: `<surface>:<section|unknown>:<rail_name>`
- `container_id`: optional for `container_type=screen`
  - omit unless a surface contains multiple distinct browse containers without a surface change; if omitted, treat as `<surface>:default`

### 2.9 Studio combination vocabulary
`combo_key` represents the current combination (hidden slots are nulls):
`top:<id-or-null>|bottom:<id-or-null>|shoes:<id-or-null>`

---

## 3) Browse depth contract (`items_seen_summary`) (locked)

`items_seen_summary` answers: “how much did the user browse before acting?” across both screens and rails, without emitting per-item impression events.

### 3.1 “Seen” rule
An item counts as “seen” when it is:
- ≥50% visible for ≥300ms.

### 3.2 Stable identity + dedupe
Internally, “unique” must be computed on:
- `stable_item_key = <entity_type>:<entity_id>`

### 3.3 Metrics
- `unique_items_seen_count` = count of distinct `stable_item_key` that met the “seen” rule.
- `max_position_seen` = max `position` among items that met the “seen” rule.

### 3.4 Emission triggers
Emit summaries deterministically (avoid “rail finished” heuristics):
- `container_type=screen`: emit on **surface exit**
- `container_type=rail`: emit on **surface exit** for each rail that had ≥1 seen item

### 3.5 Ordering, flush, and reset rules
Surface-change ordering rule (locked):
- On surface exit, flush `items_seen_summary` first, then emit `screen_duration`, then emit the next `screen_entered`.

Flush safeguards (required to avoid losing summaries):
- On `pagehide` / tab close: flush any pending `items_seen_summary` for the current surface.
- On session rotation (new `session_id`): flush any pending `items_seen_summary` before rotating.

Reset rule (locked):
- If the underlying dataset changes while staying on the same surface (e.g., `search_id` changes on `surface=search_results`, or a rail dataset is replaced), flush the affected container summaries **first**, then reset the seen set and continue tracking.

### 3.6 Implementation requirement (efficiency)
All screen + rail impressions must flow through a **single shared** observer/aggregator so the seen rule, dedupe, and position ordering remain identical across surfaces.

Implementation note (efficient approach):
- Prefer one `IntersectionObserver` (threshold 0.5) + per-item 300ms timers.
- Do not use scroll listeners for impression counting.
- Centralize flush into one `flushPendingSummaries()` hook called from all exit paths (surface exit, `pagehide`, session rotation, dataset reset).

---

## 4) Events (source of truth)

Event names use `snake_case`.

### 4.1 Timing + navigation

#### `screen_entered`
- **When:** immediately on entering any `surface`.
- **Why:** canonical journey reconstruction across the app.
- **Props (always):** `session_id`, `surface`, `entry_surface`.
- **Props (conditional):**
  - if `surface=landing`: `utm_*`, `referrer`, `landing_path`, `is_returning_device` (captured on every landing entry)
  - if `surface=home_moodboard`: `moodboard_slug`
  - if `surface` is an auth surface: `has_invite_param` (boolean)

#### `screen_duration`
- **When:** on surface change and on session end.
- **Why:** active time per surface (pauses while hidden).
- **Props:** `session_id`, `surface`, `active_duration_ms`.

Implementation note (efficient approach):
- Maintain a single “active time accumulator” per surface that pauses/resumes on `visibilitychange`.
- Define a “surface change” as a change in the computed `surface` value (not merely a URL/query param change).
- On surface exit, flush `items_seen_summary` first, then emit `screen_duration`, then emit the next `screen_entered`.
- Emit `screen_duration` on surface changes and on `pagehide`.

Session rotation anchor (locked):
- If a session rotates while the user remains on the same surface (no surface change):
  - flush pending `items_seen_summary`
  - emit `screen_duration` for the old session’s current surface
  - rotate `session_id`
  - emit a fresh `screen_entered` for the current surface with `entry_surface="unknown"`

### 4.2 Acquisition + waitlist + invite

#### `waitlist_submitted`
- **When:** waitlist submission completes.
- **Why:** landing → waitlist conversion by channel/referrer.
- **Props:** `session_id`, `surface`, `result` (`success|already_registered|validation_error|server_error`), `utm_*`, `referrer`, `waitlist_source`.

`waitlist_source` values (locked):
- `landing_form | share_link | other`

#### `invite_code_validated`
- **When:** invite code validation completes.
- **Why:** invite friction before signup.
- **Props:** `session_id`, `surface`, `valid` (boolean), `reason` (if invalid).

#### `invite_redeemed`
- **When:** invite redemption succeeds (no invite code stored).
- **Why:** invite lifecycle step; enables invited→redeemed analysis.
- **Props:** `session_id`, `surface=auth_callback`, `success=true`.

### 4.3 Auth outcomes + identify/reset

#### `auth_signup_succeeded`
- **When:** signup succeeds.
- **Why:** canonical “signup conversion” marker.
- **Props:** `session_id`, `surface=auth_callback`.

#### `auth_login_succeeded`
- **When:** login succeeds.
- **Why:** “activated auth session” marker for returning users.
- **Props:** `session_id`, `surface=auth_callback`.

Identify rule (locked):
- On successful auth (`auth_signup_succeeded` or `auth_login_succeeded`), call `identify()` and set `email` as a person property.

Logout/reset rule (locked):
- On logout, call PostHog reset (`reset()` or equivalent) to clear the identified user.
- Also start a new `session_id` (same behavior as session rotation anchor) to prevent cross-user journeys on shared devices.

### 4.4 Browse depth

#### `items_seen_summary`
- **When:** emitted per the browse depth contract (section 3).
- **Why:** browse depth across screens and rails.
- **Props:**
  - always: `session_id`, `surface`, `container_type`, `layout`, `max_position_seen`, `unique_items_seen_count`
  - when applicable: `section`, `container_id`, `rail_id`, `moodboard_slug`
  - for `surface=search_results`: `search_id`, `mode`

### 4.5 Search (tied by `search_id`)

#### `search_submitted`
- **When:** a new search results set is generated.
- **Why:** anchors a results set and ties downstream actions to query/filters.
- **Props:** `session_id`, `surface=search_results`, `entry_surface`, `search_id`, `search_trigger`, `query_raw`, `search_type`, `mode`, `filters`, `sort`.

Implementation note (efficient approach):
- Generate a new `search_id` only at “commit points” that refresh results (query submit, filters apply, sort change, mode change).
- When a new `search_id` is generated while staying on `surface=search_results`, flush existing `items_seen_summary` for the old results set (screen + rails) before resetting state to track the new results set.
- Use the single shared stable serializer for `filters` and `sort`.

### 4.6 Moodboard state

#### `moodboard_selected`
- **When:** active moodboard changes on Home.
- **Why:** preferences and correlation with studio entry/saves.
- **Props:** `session_id`, `surface=home_moodboard`, `moodboard_slug`.

`moodboard_slug` is the canonical identifier for the active Home tab/moodboard and may be:
- system slugs (e.g., for-you, wardrobe, favorites, try-ons)
- user-created moodboard slugs

Home moodboard/tab identity is represented by `moodboard_slug` (not by `section`).

Emission rule (locked):
- Emit `moodboard_selected` **only** for moodboard/tab switches *within* `surface=home_moodboard`.
- Do **not** emit `moodboard_selected` on initial entry to Home or when re-entering Home from another surface.

If a user navigates to Home with a particular moodboard selected (e.g., from Collections), that selection is represented by the resulting `screen_entered(surface=home_moodboard)` which includes `moodboard_slug`, and attribution comes from its `entry_surface`.

### 4.7 Unified interactions

#### `item_clicked`
- **When:** user taps an item card (outfit or product) on any surface.
- **Why:** ranking effectiveness + precursor signals to studio/saves/buys; also powers search CTR.
- **Props (always):** `session_id`, `surface`, `entity_type` (`outfit|product`), `entity_id`.
- **Props (when applicable):** `section`, `position`, `layout`, `rail_id`, `moodboard_slug` (when `surface=home_moodboard`).
- **Props (search context):** `search_id`, `mode` (when `surface=search_results`).

Home-specific rule (locked):
- When `surface=home_moodboard`, include `moodboard_slug` so we can break down engagement by active tab/moodboard.
- Do **not** use `section` to represent the active Home tab (system or user-created). Only include `section` on Home when it truly represents a distinct UI container with locked values (e.g. `recent` rail or `curated` grid).

#### `save_toggled`
- **When:** user toggles save via click or long press.
- **Why:** precise counting (saved vs unsaved) + method attribution.
- **Props (always):** `session_id`, `surface`, `entity_type` (`outfit|product`), `entity_id`, `new_state` (boolean), `save_method` (`click|long_press`).
- **Props (when applicable):** `section`, `position`, `layout`, `rail_id`, `moodboard_slug` (when `surface=home_moodboard`), `combo_key` (studio context only).

#### `saved_to_collection`
- **When:** a save action results in the entity being saved into a named destination collection.
- **Why:** destination analysis (wardrobe vs favorites vs moodboards).
- **Props:** `session_id`, `surface`, `entity_type` (`outfit|product`), `entity_id`, `collection_slug`, `save_method` (`click|long_press`), `moodboard_slug` (when `surface=home_moodboard`).

Relationship to `save_toggled` (locked):
- `saved_to_collection` is emitted only when the entity is successfully saved (i.e., after a save that results in `new_state=true`).
- `saved_to_collection` must not be emitted for unsaves (`new_state=false`).
- If “quick save” implies a default destination (e.g., favorites), emit `saved_to_collection` with that default `collection_slug`.
 - `save_method` must match the initiating user gesture for the save flow (so the implicit favorites save in a long-press flow uses `save_method=long_press`).

#### `product_buy_clicked`
- **When:** outbound click opens a `productUrl`.
- **Why:** commerce intent proxy by surface/section.
- **Props:** `session_id`, `surface`, `entity_type=product`, `entity_id`, `section` (when applicable), `moodboard_slug` (when `surface=home_moodboard`).

Implementation note (efficient approach):
- Use one shared helper for “entity events” that requires only `{eventName, entity_type, entity_id}` plus optional UI context (`section/layout/position/rail_id`).

### 4.8 Studio (session surfaces only)

#### `studio_combination_viewed`
- **When:** combo changes (or initializes).
- **Why:** unique combos + dwell (“stall”) time + iteration attribution via `change_type`.
- **Props (always):** `session_id`, `surface`, `outfit_id`, `combo_key`, `change_type` (`open|swap|undo|redo|checkpoint|remix|hide_slot|restore_slot`)
- **Props (conditional):**
  - when a specific slot is involved: `slot`
  - when `change_type=swap`: `from_product_id`, `to_product_id`
  - when `surface=studio_alternatives` and `change_type=swap`:
    - `results_mode` (`default|search`)
    - if `results_mode=search`, any included `filters` / `sort` / `query_raw` must use the same canonical serializer as `search_submitted` (section 2.7)

#### `studio_product_viewed`
- **When:** product detail is shown (not generic product cards).
- **Why:** which studio surfaces users rely on for product detail consumption.
- **Props:** `session_id`, `surface` (`studio_scroll_up|studio_product_page|studio_similar`), `entity_type=product`, `entity_id`.

Implementation note (efficient approach):
- Keep `studio_combination_viewed` as the single source of truth for iteration behavior (no separate undo/redo events).
- Emit on “committed state change” only (i.e., after the combo is updated).

### 4.9 Try-on / VTON lifecycle (with request identity)

#### `tryon_flow_started`
- **When:** user initiates try-on flow.
- **Why:** adoption and entry surface analysis.
- **Props:** `session_id`, `surface`, `combo_key`.

#### `tryon_generation_started`
- **When:** backend try-on generation is kicked off.
- **Why:** demand and latency measurement.
- **Props:** `session_id`, `tryon_request_id`, `combo_key`, `surface=studio_likeness`.

#### `tryon_generation_completed`
- **When:** try-on generation completes.
- **Why:** reliability + latency.
- **Props:** `session_id`, `tryon_request_id`, `combo_key`, `success`, `duration_ms`, `error_type`.

#### `tryon_result_viewed`
- **When:** user views the generated result.
- **Why:** output consumption + correlate with downstream value.
- **Props:** `session_id`, `tryon_request_id`, `combo_key`, `surface=studio_likeness`.

---

## 5) Derived metrics (how analysis is done)

### 5.1 Time to first studio
`time_to_first_studio_ms = t(first screen_entered where surface ∈ studio session surfaces) - t(session_start)`

### 5.2 Studio session time
Total Studio session time = sum of `screen_duration.active_duration_ms` where `surface` ∈:
- `studio_main`, `studio_alternatives`, `studio_scroll_up`, `studio_likeness`

### 5.3 Studio non-session times (individual only)
Track `screen_duration` individually for:
- `studio_product_page`
- `studio_similar`
- `studio_outfit_suggestions`

Do **not** aggregate these into a single “non-session” bucket.

### 5.4 Browse depth (“cards seen”)
Comes from `items_seen_summary`:
- Screen-level containers (`container_type=screen`)
- Rail-level containers (`container_type=rail`) for all rails
- For `surface=search_results`, segment by `mode`.

### 5.5 Combination dwell / stall time
Using `studio_combination_viewed`:
- Dwell ends when the next `studio_combination_viewed` happens, OR the user leaves Studio session surfaces, OR the tab becomes hidden.
- Studio non-session surfaces are excluded from combo dwell by definition.

### 5.6 Search CTR
For each `search_id`:
- Clicks are `item_clicked` where `surface=search_results` and `search_id` matches.

---

## 6) Implementation plan (optimized and efficient)

Follow this plan in order; each step builds a reusable piece used by later steps.

### Step 1 — Analytics facade (single capture API)
- Build a single wrapper for event capture that:
  - injects current `session_id` and `surface` automatically
  - enforces production gating rules (no events outside production hostnames)
- Benefit: call sites never manually assemble common properties.

### Step 2 — Session + visibility manager
- Maintain `session_id` in `sessionStorage` and rotate it on “hidden > 30m then visible”.
- Implement the session rotation anchor behavior (section 4.1).
- Maintain `is_returning_device` using a persisted local flag.
- Note: `sessionStorage` is per-tab; opening the app in a new tab will start a new `session_id`.
- Benefit: consistent sessionization + stable “returning device” segmentation.

### Step 3 — Surface router + timing
- Map routes to `surface`.
- Define a “surface change” as a change in the computed `surface` value (not merely a URL/query param change).
- On every surface change, in this order:
  - flush pending `items_seen_summary` for the previous surface (no-op until Step 6 exists)
  - emit `screen_duration` for the previous surface (using active-time accumulator)
  - emit `screen_entered` for the new surface (with `entry_surface`)
- Hook into `pagehide` to:
  - flush `items_seen_summary`
  - emit the last `screen_duration`
- Benefit: all journey + time metrics come from one mechanism.

### Step 4 — Landing attribution
- On `screen_entered(surface=landing)`, capture attribution (`utm_*`, `referrer`, `landing_path`, `is_returning_device`).
- Reuse the latest captured landing attribution in-session for `waitlist_submitted`.
- Benefit: stable acquisition reporting without extra events.

### Step 5 — Search tracking (shared serializer)
- Create one shared stable serializer for canonical `filters` and `sort`.
- Emit `search_submitted` only when results refresh (commit points) with:
  - new `search_id`
  - `search_trigger`
  - canonical `filters` / `sort`
- When `search_id` changes while staying on `surface=search_results`:
  - flush old `items_seen_summary` containers first, then reset, then track under the new `search_id`
- Benefit: consistent search analytics across Search and Studio alternatives.

### Step 6 — Unified entity interaction helpers
- Implement helpers for:
  - `item_clicked`
  - `save_toggled`
  - `saved_to_collection`
  - `product_buy_clicked`
- Benefit: one consistent schema for entity interactions, fewer event types and fewer mistakes.

### Step 7 — `items_seen_summary` manager (ImpressionsManager)
- Implement one shared manager that:
  - observes items with one `IntersectionObserver` (0.5 threshold)
  - starts/stops 300ms timers to satisfy the “seen rule”
  - aggregates per container and emits `items_seen_summary` on flush
- Implement one `flushPendingSummaries()` hook and call it from:
  - surface exit
  - `pagehide`
  - session rotation
  - dataset reset (e.g., search_id change)
- Benefit: reliable browse depth with minimal event volume.

### Step 8 — Auth identify/reset + logout behavior
- On auth success events, call `identify()` and set `email` person property.
- On logout, call PostHog reset and rotate `session_id`.
- Benefit: correct user attribution and prevents cross-user tracking leakage on shared devices.

### Step 9 — Studio tracking
- Emit `studio_combination_viewed` only on committed combo changes.
- For `results_mode=search` in Studio alternatives, reuse the canonical search serializer.
- Emit `studio_product_viewed` only for product detail screens (not cards).
- Benefit: stall-time and iteration behavior from a single event stream.

### Step 10 — Try-on lifecycle tracking
- Generate `tryon_request_id` per request and thread it through started/completed/viewed.
- Benefit: reliable latency + reliability metrics, retries, and parallel requests.

---

## 7) Implementation conventions (locked)

- `position` and `max_position_seen` are **0-based** and follow the ordering rules in section 2.5.
- Studio entry is defined as `screen_entered` where `surface` is a Studio session surface.
- `section` must use locked values only (otherwise omit).
- `search_id` must change whenever results change; use `search_trigger` to record why.
- `items_seen_summary` must follow the contract in section 3 (seen rule, dedupe, triggers, ordering, flush, reset).
