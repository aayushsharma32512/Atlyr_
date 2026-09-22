-- Tags an import with the flow that started it, so the review queue can tell a
-- wardrobe request from an inspiration one.
ALTER TABLE public.inspiration_imports
  ADD COLUMN intent text NOT NULL DEFAULT 'inspiration'
  CHECK (intent IN ('inspiration', 'wardrobe'));
