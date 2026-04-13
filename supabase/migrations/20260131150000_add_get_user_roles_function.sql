-- Add function to get user roles for enrichment review (bypasses RLS)
-- This allows admins to see roles of outfit authors for enrichment review dashboard
DROP FUNCTION IF EXISTS public.get_user_roles(uuid[]);

CREATE OR REPLACE FUNCTION public.get_user_roles(user_ids uuid[])
RETURNS TABLE (
  found_user_id uuid,
  found_role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
BEGIN
  -- Get the role of the person calling the function
  SELECT profiles.role INTO caller_role FROM profiles WHERE profiles.user_id = auth.uid();

  -- Admins can see all requested users' roles
  IF caller_role = 'admin' THEN
    RETURN QUERY
    SELECT p.user_id, p.role
    FROM profiles p
    WHERE p.user_id = ANY(user_ids);
  ELSE
    -- Non-admins can only see their own role
    RETURN QUERY
    SELECT p.user_id, p.role
    FROM profiles p
    WHERE p.user_id = auth.uid() AND p.user_id = ANY(user_ids);
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_roles(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_user_roles IS 'Fetches roles for given user IDs, bypassing RLS for enrichment review dashboard';
