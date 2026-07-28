-- Placement map: the transform the studio uses to render a garment on the fixed 1800x3072
-- placement mannequin, as produced by the mesh editor (PlacementMeshEditor) and the Modal
-- placement service.
--
-- Stored as ONE JSONB column `placement`: a map of "gender:body_type" -> { tx, ty, scale,
-- rotationDeg, warp }, so a single product row can carry a placement per mannequin. body_type is
-- 'bodytype1' today (the only value the studio uses); the key stays composite so adding body types
-- later needs no migration.
--
-- The legacy 2D columns (placement_x, placement_y, image_length, product_length) are intentionally
-- LEFT INTACT — different units, and they drive the SVG avatar fallback for every product that has
-- no placement entry yet. Nothing is retired here.
--
-- Additive + idempotent: nullable, no default, ADD COLUMN IF NOT EXISTS. Applied to both the live
-- catalog (products) and the ingestion staging table (ingested_products), which share the
-- deterministic product id.

ALTER TABLE public.products          ADD COLUMN IF NOT EXISTS placement JSONB;
ALTER TABLE public.ingested_products ADD COLUMN IF NOT EXISTS placement JSONB;

COMMENT ON COLUMN public.products.placement IS
  'Map of "gender:body_type" -> { tx, ty, scale, rotationDeg, warp } in the 1800x3072 placement-canvas space (mesh editor / Modal placement). Legacy 2D placement stays in placement_x/placement_y/image_length.';

COMMENT ON COLUMN public.ingested_products.placement IS
  'Map of "gender:body_type" -> { tx, ty, scale, rotationDeg, warp } in the 1800x3072 placement-canvas space (mesh editor / Modal placement). Legacy 2D placement stays in placement_x/placement_y/image_length.';
