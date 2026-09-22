-- The stacking order a user chose for a look: slot names, front-most first, e.g. {bottom,top,shoes}.
-- Null means the app's default rule applies (top in front; a bodysuit under the bottom).
-- Additive and nullable: existing rows read null and older app builds never select the column.
ALTER TABLE public.outfits
  ADD COLUMN IF NOT EXISTS layer_order text[];

-- A value is a permutation of the three slots: exactly three entries that together cover top, bottom, shoes.
ALTER TABLE public.outfits
  ADD CONSTRAINT outfits_layer_order_is_slot_permutation
  CHECK (
    layer_order IS NULL
    OR (array_length(layer_order, 1) = 3 AND layer_order @> ARRAY['top', 'bottom', 'shoes'])
  );

COMMENT ON COLUMN public.outfits.layer_order
  IS 'Stacking order chosen by the user: slot names, front-most first. Null means the default rule applies.';
