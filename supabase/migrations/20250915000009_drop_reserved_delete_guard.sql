-- Drop the overly restrictive trigger that blocks deleting items
-- from system collections (e.g., 'favorites') in user_favorites.
-- Root cause: validate_collection_operation_trigger raised an exception
-- on DELETE when OLD.collection_slug was a reserved slug, which prevents
-- removing a single favorite item. System collection protection is now
-- handled at the collection level via user_collections + manage_collection.

-- 1) Drop the trigger if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'validate_collection_operation_trigger'
  ) THEN
    EXECUTE 'DROP TRIGGER validate_collection_operation_trigger ON public.user_favorites';
  END IF;
END $$;

-- 2) Drop the trigger function if it exists
DROP FUNCTION IF EXISTS public.validate_collection_operation() CASCADE;

-- 3) Keep normalization trigger in place (no-op here), and ensure RLS
--    policies still allow users to manage their own favorites.
--    No additional changes required.

-- Optional sanity note:
-- After this migration, DELETEs from public.user_favorites where
-- collection_slug = 'favorites' succeed, allowing users to remove
-- items from system collections as intended.

