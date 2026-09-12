-- Short share links for Studio looks: /s/<slug> -> the long /studio?...&share=1 path.
-- Anyone may resolve a slug; only a signed-in user may mint one.
-- One path gets one slug: a re-share returns the existing link instead of a new row.

CREATE TABLE IF NOT EXISTS public.share_links (
  slug        text PRIMARY KEY,
  path        text NOT NULL,
  created_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Same-origin only: a slug must never become an open redirect.
  CONSTRAINT share_links_path_relative CHECK (path ~ '^/[^/\\]'),
  CONSTRAINT share_links_path_key UNIQUE (path)
);

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can resolve a share link"
ON public.share_links
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Signed-in users can create share links"
ON public.share_links
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());
