-- Update the handle_new_user trigger function to include all necessary fields with default values
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id, 
    name, 
    onboarding_complete,
    age,
    city,
    selected_silhouette
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', 'User'),
    false,
    NULL,
    NULL,
    'default'
  );
  RETURN NEW;
END;
$$;