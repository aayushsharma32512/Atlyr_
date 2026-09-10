-- Let a user disown an outfit they created.
--
-- "Delete" on a creation is an anonymise, not a hard delete: the row is kept for
-- anyone else who saved it, and only the attribution is stripped
-- (collectionsService.anonymiseOutfit sets created_by = NULL, user_id = NULL).
--
-- That update has never been able to succeed. The UPDATE policy's WITH CHECK is
-- evaluated against the NEW row, and `auth.uid() = NULL` is never true — so the
-- act of disowning the row is exactly what fails the ownership check that permits
-- the update. Postgres rejects it with "new row violates row-level security
-- policy", the drawer shows "Delete failed. Try again.", and the creation stays.
--
-- USING is unchanged: you can still only target rows you own. WITH CHECK now also
-- accepts a row that ends up owned by nobody. It does not let a user take
-- someone else's outfit (USING blocks it) or hand theirs to another user
-- (WITH CHECK still rejects any other non-null user_id). This is the same shape
-- the INSERT policy already uses: `user_id IS NULL OR auth.uid() = user_id`.

DROP POLICY IF EXISTS "Users can update their own outfits" ON public.outfits;

CREATE POLICY "Users can update their own outfits"
ON public.outfits
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
