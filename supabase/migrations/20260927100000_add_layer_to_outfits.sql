-- The layer piece: a product worn over the top (an open shirt, a blazer, a corset).
-- Additive: existing rows read null or false, and older app builds never select these columns.

-- The product worn over the top. It always draws in front and is not part of layer_order.
ALTER TABLE public.outfits
  ADD COLUMN IF NOT EXISTS layer_id text;

-- Deleting a product removes it as a layer but keeps the look (top, bottom and shoes delete the look).
ALTER TABLE public.outfits
  ADD CONSTRAINT outfits_layer_id_fkey
    FOREIGN KEY (layer_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- Serves the foreign key's SET NULL on product delete; partial because almost every row has no layer.
CREATE INDEX IF NOT EXISTS outfits_layer_id_idx
  ON public.outfits (layer_id)
  WHERE layer_id IS NOT NULL;

COMMENT ON COLUMN public.outfits.layer_id
  IS 'The product worn over the top. It always draws in front and is not part of layer_order. Null means no layer.';

-- Tops that can be worn as a layer. The Layer tab lists only these.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS layerable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.layerable
  IS 'True when the product can be worn over a top as a layer. The Layer tab lists only these.';
