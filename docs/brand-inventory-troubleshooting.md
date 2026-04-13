# Brand Inventory – Troubleshooting Summary

## 1. Phase 1 Edits Reverting After Completion
- **Symptom**: Operator changes (brand, image tags) were saved in the dashboard but disappeared once Phase 1 resumed.
- **Cause**: LangGraph resumed from the checkpoint captured before the HITL edits. We persisted changes to Supabase only; the `MemorySaver` snapshot remained stale and overwrote the DB on resume.
- **Resolution**: After every Phase 1 save/complete we now merge the latest `PipelineState` into the MemorySaver tuple and call `checkpointer.put(...)`. The orchestrator resumes from the human-edited state.

## 2. Image Array Writes Dropping Untouched Entries
- **Symptom**: Editing a single image and saving removed the other images from `draft.images`.
- **Cause**: We sent a partial array; `mergePipelineState` replaced the entire field with that smaller payload.
- **Resolution**: The dashboard now sends per-image diff patches (`buildImagePatches`) and updates `artifacts.rawImages`, ensuring unchanged entries stay intact.

## 3. Product Saves Silently Failing
- **Symptom**: “Save Changes” showed success, but Supabase never updated.
- **Cause**: The payload used `price` instead of `price_minor` (schema mismatch). `/jobs/:id/phase1` rejected payloads with 400, but the UI didn’t surface the error.
- **Resolution**: Map UI fields to backend schema (e.g. convert price to `price_minor`) and surface API errors to operators.

## 4. Missing Image Thumbnails in HITL Grid
- **Symptom**: Reviewers saw long image URLs instead of thumbnails.
- **Cause**: The UI didn’t resolve Supabase storage paths to public URLs.
- **Resolution**: Use `supabase.storage.from(bucket).getPublicUrl(storage_path)` (fall back to the original URL) to render inline thumbnails.

## 5. Radix Select Crash on "Unassigned"
- **Symptom**: Selecting "Unassigned" triggered “A Select.Item must have a value prop that is not an empty string.”
- **Cause**: Radix Select disallows `value=""`.
- **Resolution**: Introduced a synthetic `"none"` option that maps to `null` when saving.

## 6. Typed Node Wiring Pain Points
- **Symptom**: Converting pause nodes to typed writers caused TypeScript errors.
- **Cause**: Misuse of the `typedNode` helper signature and handler arguments.
- **Resolution**: Use `typedNode(GraphAnnotation.State, { writes: ['state'] })` with a handler that destructures `{ state }` and returns `typeof GraphAnnotation.Update`.

## 7. Workflow Observability
- **Symptom**: Hard to verify that saves/resumes worked; no guidance for testing.
- **Actions**:
  - Documented `/jobs/:jobId/phase1` flow, checkpoint merging, and verification steps.
  - Recommend test loop: submit job → edit → save → check Supabase → complete Phase 1 → confirm edits persist at `hitl_phase2_pause`.

---
Keep this document updated whenever new issues surface. It serves as the reference playbook for debugging the brand inventory HITL pipeline.

---

Brand Inventory HITL Issues Retrospective

1. Phase 1 Never Resumed

What we saw
After operators clicked “Complete Phase 1”, the job stayed on hitl_phase1_pause.
Supabase rows still had pause.resumeSignal = { actor: 'phase1', action: 'resume' }, no hitlPhase1Completed, and no hitl_phase1_resumed timestamp.
Orchestrator logs showed repeated interrupts at the same node.

Root cause
/jobs/:id/phase1 correctly saved edits and enqueued a resume, but hitlPhase1PauseNode’s patch was overwritten. The orchestrator worker fetched LangGraph’s checkpoint after the node ran, saw the stale pause (because the checkpoint never got the cleared state), and persisted that stale snapshot back to Supabase. “Last write wins” brought the old pause back, so the pipeline never advanced.

Fix
Reconcile the stores inside registerOrchestratorWorker: fetch the fresh Supabase row immediately after the node runs, push it into LangGraph (updateState) before fetching the checkpoint snapshot, then merge the snapshot with the fresh state, persist, and push it back into the checkpoint. That keeps Supabase and the in‑memory state aligned, so the Phase 1 completion flag/timestamp survive and the workflow flows into hitl_phase2_pause.

2. (Secondary) Operator edits lost suspicion

Observation
While Phase 1 was stuck, we confirmed edits themselves (product details, image tagging) did stick—just the pause metadata rolled back. No extra changes were needed beyond the fix above.
