# Figma Design Context → Implementation Guide

This document recaps the workflow we have been using to pull detailed design context from Figma and translate it into production-ready components inside this repo. Share it with anyone who needs to mirror the same process.

## 1. Toolchain Recap

| Purpose | Tool / Command | Notes & Example Prompt |
| --- | --- | --- |
| Locate screen/component nodes | Figma share link | Copy the `fileKey` and `nodeId` from the URL (`https://figma.com/design/<fileKey>/<name>?node-id=<nodeId>`). |
| Inspect hierarchy before diving in | `mcp_Figma_get_metadata` | “Give me the metadata for node `123:456` so I can see its structure before I fetch design context.” |
| Pull full design context + code suggestions | `mcp_Figma_get_design_context` | “Return the design context for node `123:456` (Search Screen) including layout, spacing tokens, colors, typography, and semantic descriptions of interactive states.” |
| Grab high-fidelity visuals | `mcp_Figma_get_screenshot` | “Screenshot node `123:456` for visual verification.” |
| Capture variables/tokens from the file | `mcp_Figma_get_variable_defs` | Useful when mapping colors/spacing to our design system tokens. |

> Tip: Always include `clientLanguages: "typescript"` and `clientFrameworks: "react"` in tool calls so the responses stay aligned with our stack.

## 2. Step-by-Step Workflow

### 2.1 Identify the design target
1. Open the shared Figma file.
2. Copy the screen/component URL; extract `fileKey` + `nodeId`.
3. Note key breakpoints or variants (mobile/tablet/desktop) that need coverage.

### 2.2 Explore the structure
1. Run `mcp_Figma_get_metadata` with the target `nodeId`.
2. Skim the returned tree to understand grouping, nested instances, and naming that maps to design tokens.
3. Flag any shared primitives (buttons, cards) so you can reuse or extend `src/design-system`.

### 2.3 Pull design context & assets
1. Call `mcp_Figma_get_design_context` with a descriptive prompt, e.g.:
   - “Describe the Search Results grid screen: list layout, spacing, typography, color tokens, component variants, and interaction hints. Include any annotations about empty/error/loading states.”
2. If the screen has subcomponents, repeat the call for each child `nodeId`.
3. Use `mcp_Figma_get_variable_defs` when you need the exact token names (color/spacing/elevation).
4. Download screenshots for QA references.

### 2.4 Translate context into code
Follow our “Supabase → services → TanStack Query hooks → screens” architecture:

1. **Services (`src/services/<domain>`):** Add/adjust Supabase accessors or domain transforms required by the screen.
2. **Query key factory (`src/features/<domain>/queryKeys.ts`):** Ensure every hook derives keys from the factory.
3. **Hooks (`src/features/<domain>/hooks`):** Wrap service calls with `useQuery` / `useMutation`, configure caching (`staleTime`, `gcTime`), and handle invalidations/prefetch.
4. **Screen components (`src/features/<domain>/<Screen>.tsx` or `src/pages`):** Stay declarative—import hooks, render data via design-system primitives, no business logic.
5. **Design system primitives (`src/design-system/primitives`):** If Figma introduces a new reusable element, build or extend it here so other screens can consume it.

While implementing UI:
- Map colors to existing tokens from `design-system/tokens`.
- Respect spacing/typography pulled from design context.
- Capture responsive rules noted in the Figma description (e.g., grids collapsing from 4 → 2 columns).

### 2.5 Validate & iterate
1. Compare renders against the screenshot reference.
2. Verify Supabase data flow using Storybook or local pages.
3. Add/extend tests (e.g., `renderHook` for TanStack hooks, component tests for critical UI states).

## 3. Prompt Templates

Use or adapt these snippets when interacting with the Figma tooling:

- **Metadata sweep**
  ```
  Fetch metadata for node 123:456 in file pqrs. Highlight immediate children and note any nested variants.
  ```
- **Design context (screen)**
  ```
  Provide the design context for node 123:456 (Home Screen). Include: layout grid, spacing scale, typography stack, color tokens, component inventory, and guidance for empty/loading/error states.
  ```
- **Design context (component)**
  ```
  Describe the Product Alternate Card component (node 789:1011). Detail its props, states (default/hover/selected), responsive behavior, and map visual primitives to reusable tokens.
  ```
- **Asset request**
  ```
  Screenshot node 123:456 at 1x. Use it as build reference for QA.
  ```
- **Variable inspection**
  ```
  List tokens/variables applied within node 123:456 so I can align them with our design-system theme.
  ```

Feel free to tweak wording, but keep the intent explicit (what node, what level of detail, which states).

## 4. Troubleshooting & Best Practices

- **No design context returned?** Double-check the `nodeId` (Figma often formats it as `PageID:NodeID`). Re-run metadata to confirm it exists.
- **Missing tokens?** Use variable defs; if still unclear, fall back to screenshot sampling and map to the closest existing token.
- **New data requirement?** Add/adjust domain services first; never call Supabase directly from components.
- **Performance concerns?** Use query prefetching (`queryClient.prefetchQuery` or `useSuspenseQueries`) when navigation flows would otherwise trigger waterfalls.
- **Version control:** Commit UI + hook changes with references to the corresponding Figma node so future readers can jump back to the source design.

By following the steps above you can consistently translate any Figma node into a well-structured implementation that aligns with our architecture and design system.

