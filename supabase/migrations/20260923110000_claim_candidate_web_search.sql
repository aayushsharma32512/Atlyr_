-- Claims one online search for a garment in a single statement, so two requests that both see
-- the garment unsearched cannot both pay for it. True means the caller owns the search.
CREATE OR REPLACE FUNCTION public.claim_candidate_web_search(
  candidate_id uuid,
  stale_seconds integer,
  max_age_seconds integer
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    UPDATE public.inspiration_import_candidates
    SET web_search_heartbeat_at = now()
    WHERE id = candidate_id
      AND (web_results IS NULL OR web_searched_at < now() - make_interval(secs => max_age_seconds))
      AND (web_search_heartbeat_at IS NULL OR web_search_heartbeat_at < now() - make_interval(secs => stale_seconds))
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

REVOKE ALL ON FUNCTION public.claim_candidate_web_search(uuid, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_candidate_web_search(uuid, integer, integer) TO service_role;
