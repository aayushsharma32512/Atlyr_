-- Collection slug constraints and protections
-- This migration adds lowercase enforcement and reserved slug protections

-- Step 1: Create function to lowercase collection_slug
CREATE OR REPLACE FUNCTION public.normalize_collection_slug()
RETURNS TRIGGER AS $$
BEGIN
  -- Always lowercase the collection_slug for canonical storage
  NEW.collection_slug = LOWER(NEW.collection_slug);
  
  -- Log the normalization for debugging
  RAISE LOG 'Collection slug normalized: % -> %', OLD.collection_slug, NEW.collection_slug;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create trigger to enforce lowercase collection_slug
CREATE TRIGGER normalize_collection_slug_trigger
  BEFORE INSERT OR UPDATE ON public.user_favorites
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_collection_slug();

-- Step 3: Create function to validate collection operations
CREATE OR REPLACE FUNCTION public.validate_collection_operation()
RETURNS TRIGGER AS $$
DECLARE
  reserved_slugs TEXT[] := ARRAY['favorites', 'generations'];
  operation_type TEXT;
BEGIN
  -- Determine operation type
  IF TG_OP = 'DELETE' THEN
    operation_type := 'DELETE';
  ELSIF TG_OP = 'UPDATE' THEN
    operation_type := 'UPDATE';
  ELSE
    operation_type := 'INSERT';
  END IF;
  
  -- For UPDATE and DELETE, check if trying to modify reserved collections
  IF operation_type IN ('UPDATE', 'DELETE') THEN
    -- Check if the collection_slug is reserved
    IF OLD.collection_slug = ANY(reserved_slugs) THEN
      RAISE EXCEPTION 'Cannot % system collection: %', 
        LOWER(operation_type), 
        OLD.collection_slug
        USING ERRCODE = '23503'; -- foreign_key_violation
    END IF;
  END IF;
  
  -- For UPDATE, check if trying to rename to a reserved slug
  IF operation_type = 'UPDATE' AND NEW.collection_slug != OLD.collection_slug THEN
    IF NEW.collection_slug = ANY(reserved_slugs) THEN
      RAISE EXCEPTION 'Cannot rename collection to reserved slug: %', 
        NEW.collection_slug
        USING ERRCODE = '23503'; -- foreign_key_violation
    END IF;
  END IF;
  
  -- Log the validation for debugging
  RAISE LOG 'Collection operation validated: % on slug %', operation_type, COALESCE(NEW.collection_slug, OLD.collection_slug);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to validate collection operations
CREATE TRIGGER validate_collection_operation_trigger
  BEFORE UPDATE OR DELETE ON public.user_favorites
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_collection_operation();

-- Step 5: Create RPC function for safe collection management
CREATE OR REPLACE FUNCTION public.manage_collection(
  p_operation TEXT, -- 'create', 'rename', 'delete'
  p_collection_slug TEXT,
  p_collection_label TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  reserved_slugs TEXT[] := ARRAY['favorites', 'generations'];
  normalized_slug TEXT;
BEGIN
  -- Normalize the slug
  normalized_slug := LOWER(p_collection_slug);
  
  -- Validate operation
  IF p_operation NOT IN ('create', 'rename', 'delete') THEN
    RAISE EXCEPTION 'Invalid operation: %. Must be create, rename, or delete', p_operation;
  END IF;
  
  -- Check for reserved slugs
  IF normalized_slug = ANY(reserved_slugs) THEN
    RAISE EXCEPTION 'Cannot % reserved collection: %', p_operation, normalized_slug;
  END IF;
  
  -- Ensure user is authenticated
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;
  
  -- Execute operation based on type
  CASE p_operation
    WHEN 'create' THEN
      -- Check if collection already exists for this user
      IF EXISTS (
        SELECT 1 FROM public.user_favorites 
        WHERE user_id = p_user_id 
        AND collection_slug = normalized_slug
        LIMIT 1
      ) THEN
        RAISE EXCEPTION 'Collection already exists: %', normalized_slug;
      END IF;
      
      -- Create a dummy entry to establish the collection
      -- This will be cleaned up when real items are added
      INSERT INTO public.user_favorites (user_id, collection_slug, collection_label, outfit_id)
      VALUES (p_user_id, normalized_slug, COALESCE(p_collection_label, INITCAP(normalized_slug)), 'dummy_' || gen_random_uuid()::text);
      
      result := jsonb_build_object(
        'success', true,
        'operation', 'create',
        'collection_slug', normalized_slug,
        'collection_label', COALESCE(p_collection_label, INITCAP(normalized_slug))
      );
      
    WHEN 'rename' THEN
      -- Check if target collection exists
      IF NOT EXISTS (
        SELECT 1 FROM public.user_favorites 
        WHERE user_id = p_user_id 
        AND collection_slug = normalized_slug
        LIMIT 1
      ) THEN
        RAISE EXCEPTION 'Collection not found: %', normalized_slug;
      END IF;
      
      -- Update collection label (slug remains the same for data integrity)
      UPDATE public.user_favorites 
      SET collection_label = COALESCE(p_collection_label, collection_label)
      WHERE user_id = p_user_id AND collection_slug = normalized_slug;
      
      result := jsonb_build_object(
        'success', true,
        'operation', 'rename',
        'collection_slug', normalized_slug,
        'collection_label', COALESCE(p_collection_label, INITCAP(normalized_slug))
      );
      
    WHEN 'delete' THEN
      -- Check if collection exists
      IF NOT EXISTS (
        SELECT 1 FROM public.user_favorites 
        WHERE user_id = p_user_id 
        AND collection_slug = normalized_slug
        LIMIT 1
      ) THEN
        RAISE EXCEPTION 'Collection not found: %', normalized_slug;
      END IF;
      
      -- Delete all memberships in this collection
      DELETE FROM public.user_favorites 
      WHERE user_id = p_user_id AND collection_slug = normalized_slug;
      
      result := jsonb_build_object(
        'success', true,
        'operation', 'delete',
        'collection_slug', normalized_slug
      );
  END CASE;
  
  -- Log the operation for debugging
  RAISE LOG 'Collection management: % completed for user % on collection %', 
    p_operation, p_user_id, normalized_slug;
  
  RETURN result;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error for debugging
    RAISE LOG 'Collection management error: % - %', SQLSTATE, SQLERRM;
    
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'error_code', SQLSTATE,
      'operation', p_operation,
      'collection_slug', normalized_slug
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 6: Grant execute permission to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION public.manage_collection TO authenticated, anon;

-- Step 7: Add helpful indexes for collection queries
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_collection_lower 
ON public.user_favorites (user_id, LOWER(collection_slug));

-- Step 8: Create function to get user collections with metadata
CREATE OR REPLACE FUNCTION public.get_user_collections(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  collection_slug TEXT,
  collection_label TEXT,
  item_count BIGINT,
  is_system BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
DECLARE
  reserved_slugs TEXT[] := ARRAY['favorites', 'generations'];
BEGIN
  RETURN QUERY
  SELECT 
    uf.collection_slug,
    uf.collection_label,
    COUNT(*) as item_count,
    (uf.collection_slug = ANY(reserved_slugs)) as is_system,
    MIN(uf.created_at) as created_at
  FROM public.user_favorites uf
  WHERE uf.user_id = p_user_id
  GROUP BY uf.collection_slug, uf.collection_label
  ORDER BY 
    CASE WHEN uf.collection_slug = ANY(reserved_slugs) THEN 0 ELSE 1 END,
    uf.collection_label;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_user_collections TO authenticated, anon;
