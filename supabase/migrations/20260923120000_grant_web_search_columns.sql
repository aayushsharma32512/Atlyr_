-- The workflow tables allow no direct writes. The online search cache is the one exception:
-- the edge function stores results and the heartbeat straight onto the candidate row.
GRANT UPDATE (web_results, web_searched_at, web_search_heartbeat_at)
  ON public.inspiration_import_candidates TO service_role;
