-- One paid online search per garment: the listings the last search returned, when it ran, and a
-- beat the running search touches so a second request can tell a live search from a dead one.
ALTER TABLE public.inspiration_import_candidates
  ADD COLUMN web_results jsonb,
  ADD COLUMN web_searched_at timestamptz,
  ADD COLUMN web_search_heartbeat_at timestamptz;
