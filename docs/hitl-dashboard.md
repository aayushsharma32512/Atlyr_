# HITL Dashboard – Minimal Unified Inventory Review UX Spec

## 1. Goals & Scope
- Single page that lets an operator review a job, complete Phase 1 tagging, and complete Phase 2 approval.
- Focus on must-have capabilities required for the end-to-end workflow, aligned with current automation outputs.

## 2. Layout Overview (Desktop Baseline)
```
┌─────────────────────────────────────────────────────────────┐
│ Header                                                       │
├───────────────┬──────────────────────────────────────────────┤
│ Job Sidebar   │ Main Workspace                               │
├───────────────┴──────────────────────────────────────────────┤
│ Action Footer (phase-specific primary CTA)                   │
└─────────────────────────────────────────────────────────────┘
```
- Header: job status badge, job ID, brand, domain, last updated timestamp, manual refresh button.
- Job Sidebar: collapsible list of recent jobs with status pill and submitted time.
- Main Workspace: two tabs (`Phase 1 Tagging`, `Phase 2 Approval`). `Phase 2` disabled until Phase 1 complete.
- Action Footer: sticky bar with the primary button (`Complete Phase 1` or `Approve & Stage`) plus validation summary.

Responsive note: on tablets/mobile the sidebar collapses behind a toggle; main workspace becomes single column with footer sticky at bottom.

## 3. Shared Workspace Elements
- **Product Summary card** (top of main area): thumbnail of primary image, product name, price, link to source URL.
- **Validation strip**: inline chips showing blocking issues (e.g., `Primary image missing`, `Ghost requires rear view`). Clicking highlights the relevant control.
- **Auto-refresh toggle**: default on (poll every 15s). Manual `Refresh` button remains available in header.

## 4. Phase 1 – Tagging
### 4.1 Product Form (left column)
- Editable fields: `Brand`, `Product Name`, `Price`, `Currency`, `Fit`, `Feel`, `Material`, `Gender`, `Description` (plain textarea), `Size Chart` (JSON textarea), `Care`.
- Each field shows extracted value as placeholder; actual input overwrites.
- **Save interaction**: operator makes edits, then clicks `Save Changes` button (top-right of form). Button stays disabled until form is dirty. On click, send minimal diff to `POST /jobs/:jobId/phase1`.
- Required validations: `Price`, `Currency`, `Primary image`.

### 4.2 Image Tagging Grid (right column)
- Display extracted images in a grid (2 columns). Each tile contains:
  - Thumbnail + file metadata (dimensions, size, sort order).
  - Radio for `Primary Image` (only one can be selected).
  - Dropdown for `product_view` with options `Front`, `Back`, `Side`, `Detail`, `Other`.
  - Switches for `Ghost Eligible`, `Summary Eligible`, `VTO Eligible`.
- **Save interaction**: image tagging changes accumulate locally; `Save Image Tags` button above the grid writes updates via `POST /jobs/:jobId/phase1` when clicked.
- Basic validation rules enforced inline:
  - Ghost requires `product_view` front or back.
  - Summary Eligible capped at 3 images total.

### 4.3 Completion Flow
- Footer button `Complete Phase 1` remains disabled until validations pass.
- On click, confirm modal summarises outstanding warnings and posts `{ complete: true }` to Phase 1 endpoint.
- After submission, workspace shows loading state until LangGraph resumes and status updates to `Automation Running`.

## 5. Phase 2 – Approval
### 5.1 Automation Output Summary
- List the three downstream nodes feeding HITL Phase 2: `Garment Summary`, `Enrich`, `Background Removal`.
- Each entry shows status badge (`Success`, `Pending`, `Error`) and timestamp. Errors surface a `View details` modal with the message from state.

### 5.2 Product Review
- Side-by-side diff table with two columns: `Before (Extract)` and `After (Automation/Current)` for key fields (fit, feel, description, size chart, garment summaries).
- Operator edits final values using the same controls as Phase 1. **Save interaction**: `Save Product Edits` button persists changes via `POST /jobs/:jobId/phase2` (no auto-save).
- Garment summary front/back displayed in collapsible sections with plain text.

### 5.3 Processed Images Review
- For each processed asset, show **original vs processed** pairs (side-by-side images). Primary focus on background-removed outputs; include ability to toggle primary/eligibility tags just like Phase 1 if adjustments are needed.
- `Save Image Edits` button submits changes via `POST /jobs/:jobId/phase2`.

### 5.4 Regeneration Controls
- Provide buttons for each automation node:
  - `Regenerate Garment Summary`
  - `Regenerate Enrich`
  - `Regenerate Ghost (Background Removal)` – grouped because ghost mannequin feeds background removal; regenerating should rerun both nodes.
- Clicking opens a modal requesting optional notes, then POSTs to Phase 2 endpoint with `{ action: 'regenerate', node: 'garment_summary' | 'enrich' | 'ghost' }` (ghost includes both underlying steps). UI marks the relevant section as `Pending Regeneration` until LangGraph completes the rerun.

### 5.5 Approval Flow
- Validation strip must be clear (no blocking errors).
- Footer button `Approve & Stage` sends `POST /jobs/:jobId/phase2` with `{ action: 'approve' }`.
- Show spinner overlay while LangGraph progresses to `stage`/`promote`. Once completed, status badge switches to `Completed`.

## 6. Insight Drawer (Optional Panel)
- Simplified log showing latest validations and a basic event timeline (pause, resume, node completion) pulled from state timestamps.
- Drawer collapses by default on small screens.

## 7. Minimal Data Flow & API Usage
- **Initial Load**: `GET /jobs/:jobId` to hydrate entire view. Client derives current phase from `state.pause.reason` and `flags`.
- **Phase 1 Save**: `POST /jobs/:jobId/phase1` with `{ patch }` when operator clicks save buttons; send `{ patch, complete: true }` on completion.
- **Phase 2 Save/Approve**: `POST /jobs/:jobId/phase2` with `{ patch }` for manual edits; send `{ action: 'approve' }` on final approval; send `{ action: 'regenerate', node }` for regenerations.
- **Polling**: every 15s (configurable) until status becomes `Completed`. Polling suspended while modals open to prevent flicker.
- **Auth**: Bearer token header required; 401 triggers sign-in prompt (outside scope of this doc).

## 8. Out-of-Scope for First Cut
- Global search and advanced filtering.
- Detailed activity logging with user attribution.
- Bulk image operations beyond simple toggles.
- Analytics dashboards and metrics views.

## 9. Wireframe Sketches
### 9.1 Desktop (≥1280px)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Header:  [Status Badge] Job WHITE T-SHIRT | bluorng.com | Last updated 11:47 │
│          [Refresh] [Auto-refresh ◉]                                          │
├───────────────┬──────────────────────────────────────────────────────────────┬────────────┐
│ Job Sidebar   │ Phase Tabs: [Phase 1 Tagging | Phase 2 Approval (locked)]    │ Insight    │
│ ┌──────────┐  │ ┌──────────────────────────────────────────────────────────┐ │ Drawer     │
│ │ New      │  │ │ Product Summary (primary image, title, price, URL)       │ │ ┌───────┐ │
│ │ Awaiting │  │ ├──────────────────────────────────────────────────────────┤ │ │ Valids│ │
│ │ Running  │  │ │ Phase 1 Content (if Tagging tab active):                 │ │ ├───────┤ │
│ │ Awaiting │  │ │  · Product Form (Save Changes button)                    │ │ │ Events│ │
│ │ Completed│  │ │  · Image Grid (Save Image Tags button)                   │ │ └───────┘ │
│ └──────────┘  │ │ Phase 2 Content (if Approval tab active):                │ │            │
│ [Collapse]    │ │  · Automation Summary                                    │ │            │
│               │ │  · Product Review (diff + Save Product Edits)            │ │            │
│               │ │  · Processed Images (Save Image Edits) + Regen buttons   │ │            │
│               │ │                                                          │ │            │
├───────────────┴──────────────────────────────────────────────────────────────┴────────────┘
│ Action Footer: [Validation summary icons]                           [Primary CTA]       │
└───────────────────────────────────────────────────────────────────────────── -----------┘
```

### 9.2 Tablet (768–1200px)
- Sidebar collapses behind a `Jobs` button in header.
- Insight drawer becomes accordion below main content.
- Phase content stacked vertically; buttons remain sticky via bottom toolbar.

### 9.3 Mobile (<768px)
- Header shows job title + status; `Jobs` and `Refresh` in overflow menu.
- Phase tabs render as segmented control.
- Product form, image grid, and processed images displayed sequentially with `Save` buttons following each section.
- Footer CTA becomes full-width button fixed to bottom.

## 10. Component Breakdown
| Component | Responsibility | Key Props / Data |
|-----------|----------------|-------------------|
| `InventoryDashboard` | Page shell; orchestrates data fetching, polling, and tab switching | `jobId`, `initialState`, `status` |
| `JobSidebar` | Displays list of jobs with minimal metadata | `jobs`, `selectedJobId`, `onSelect` |
| `HeaderBar` | Shows status badge, job metadata, refresh controls | `status`, `jobId`, `brand`, `domain`, `lastUpdated`, `autoRefresh`, `onToggleAuto`, `onRefresh` |
| `PhaseTabs` | Handles Phase 1 vs Phase 2 selection and lock state | `activeTab`, `phase1Complete`, `onTabChange` |
| `ProductSummaryCard` | Snapshot of current product with primary image | `product`, `primaryImage` |
| `ValidationStrip` | Renders blocking validation chips | `validations`, `onSelectValidation` |
| `Phase1ProductForm` | Editable fields for Phase 1 with save button | `productDraft`, `onSave`, `isSaving`, `errors` |
| `Phase1ImageGrid` | Image tagging controls with save button | `images`, `onSave`, `isSaving`, `errors` |
| `Phase1CompleteFooter` | CTA and validation display for completing Phase 1 | `ready`, `onComplete`, `isSubmitting` |
| `AutomationSummaryList` | Displays status of garment summary, enrich, background removal | `automationStatus`, `onViewDetails` |
| `Phase2ProductReview` | Diff view + editable final values + save | `product`, `extractBaseline`, `onSave`, `isSaving` |
| `Phase2ImageReview` | Original vs processed pairs + toggles + save | `processedImages`, `onSave`, `isSaving` |
| `RegenerationControls` | Buttons + modals for regenerate actions | `onRegenerate(node, notes)`, `pendingNodes` |
| `Phase2Footer` | CTA for approve & stage plus validation summary | `ready`, `onApprove`, `isSubmitting` |
| `InsightDrawer` | Validations + event timeline | `validations`, `events`, `open`, `onToggle` |
| `SaveButton` (shared) | Standard button with dirty-state logic | `dirty`, `onClick`, `loading`, `label` |
| `ConfirmModal` | Reusable confirmation dialog | `open`, `title`, `body`, `onConfirm`, `onCancel`, `loading` |
| `RegenerateModal` | Prompt for regen notes | `node`, `open`, `onSubmit`, `onCancel`, `loading` |

These components align with the minimal functionality scoped above and can be implemented incrementally. Let me know if any additional sketches or component details are needed.
