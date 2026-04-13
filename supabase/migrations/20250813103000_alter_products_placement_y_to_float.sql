-- Migration: Change products.placement_y from INTEGER to DOUBLE PRECISION (float)

-- If the column already contains integers, Postgres can cast them safely to float.
ALTER TABLE public.products
  ALTER COLUMN placement_y TYPE DOUBLE PRECISION
  USING placement_y::DOUBLE PRECISION;

-- Optional: set a default or keep as null (no default set here)
-- ALTER TABLE public.products ALTER COLUMN placement_y SET DEFAULT 0.0;


