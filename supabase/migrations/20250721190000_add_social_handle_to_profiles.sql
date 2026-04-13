-- Migration: Add social_handle to profiles
ALTER TABLE public.profiles ADD COLUMN social_handle TEXT; 