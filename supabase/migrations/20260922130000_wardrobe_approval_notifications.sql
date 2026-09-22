-- A web pick reaches the owner's wardrobe only when the team approves the ingested
-- product, so the trigger watches `verdict` and not the pipeline state: the live
-- `products` row is written just before the verdict flips, which the wardrobe row
-- and the notification both depend on.

CREATE TABLE public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('wardrobe_item_added')),
  title text NOT NULL,
  body text,
  href text,
  product_id text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_notifications_user_created_idx
  ON public.user_notifications(user_id, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.user_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can mark their own notifications read"
  ON public.user_notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE public.user_notifications FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.user_notifications TO authenticated;
-- A column grant, because row-level security cannot stop an owner from rewriting the copy.
GRANT UPDATE (read_at) ON TABLE public.user_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_notifications TO service_role;

CREATE FUNCTION public.on_wardrobe_item_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_title text;
BEGIN
  SELECT product.product_name INTO v_title
  FROM public.products product
  WHERE product.id = NEW.id;
  v_title := coalesce(nullif(btrim(v_title), ''), 'A new item');

  FOR v_row IN
    SELECT selection.id AS selection_id, import_row.user_id
    FROM public.inspiration_import_selections selection
    JOIN public.ingestion_pipeline_jobs job
      ON job.job_id = selection.ingestion_job_id
    JOIN public.inspiration_imports import_row
      ON import_row.id = selection.import_id
    -- Inspiration imports share these tables and must never fill a wardrobe.
    WHERE job.ingested_product_id = NEW.id
      AND selection.source = 'web'
      AND import_row.intent = 'wardrobe'
  LOOP
    BEGIN
      INSERT INTO public.user_favorites (user_id, product_id, collection_slug, collection_label)
      VALUES (v_row.user_id, NEW.id, 'wardrobe', 'Wardrobe')
      ON CONFLICT (user_id, collection_slug, product_id) DO NOTHING;

      UPDATE public.inspiration_import_selections
      SET ingested_product_id = NEW.id, status = 'ingested'
      WHERE id = v_row.selection_id;

      INSERT INTO public.user_notifications (user_id, kind, title, body, href, product_id)
      SELECT v_row.user_id, 'wardrobe_item_added', v_title, 'is now in your wardrobe',
             '/collection/board/wardrobe', NEW.id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.user_notifications existing
        WHERE existing.user_id = v_row.user_id
          AND existing.product_id = NEW.id
          AND existing.kind = 'wardrobe_item_added'
      );
    EXCEPTION WHEN OTHERS THEN
      -- One bad row must not roll back the approval that fired this trigger.
      NULL;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wardrobe_item_approved
  AFTER UPDATE OF verdict ON public.ingested_products
  FOR EACH ROW
  WHEN (NEW.verdict = 'approved' AND OLD.verdict IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION public.on_wardrobe_item_approved();

COMMENT ON TABLE public.user_notifications IS
  'Server-side notification rows. Users read them and may only set read_at.';
