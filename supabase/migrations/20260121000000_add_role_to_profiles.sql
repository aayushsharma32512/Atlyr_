-- Add role column to profiles table with default 'user'
-- Admin roles must be assigned manually via database

-- Add the role column with NOT NULL default 'user'
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Add check constraint to ensure only valid roles
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin'));

-- Update handle_new_user trigger to explicitly set role on signup
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
    selected_silhouette,
    role
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', 'User'),
    false,
    NULL,
    NULL,
    'default',
    'user'
  );
  RETURN NEW;
END;
$$;
