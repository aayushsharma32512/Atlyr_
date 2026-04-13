-- Allow ghost renders to be stored in product_images and ingested_product_images

ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_kind_check;

ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_kind_check
  CHECK (kind IN ('flatlay', 'model', 'detail', 'ghost'));

ALTER TABLE public.ingested_product_images
  DROP CONSTRAINT IF EXISTS ingested_product_images_kind_check;

ALTER TABLE public.ingested_product_images
  ADD CONSTRAINT ingested_product_images_kind_check
  CHECK (kind IN ('flatlay', 'model', 'detail', 'ghost'));

