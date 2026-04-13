-- Adds CSV TEXT columns to profiles for storing staple product IDs per category
-- Storage format: comma-separated product IDs (as text) for tops, bottoms, shoes

begin;

alter table if exists public.profiles
  add column if not exists top_staples text null,
  add column if not exists bottom_staples text null,
  add column if not exists shoes_staples text null;

comment on column public.profiles.top_staples is 'Comma-separated product IDs (as text) for staple tops';
comment on column public.profiles.bottom_staples is 'Comma-separated product IDs (as text) for staple bottoms';
comment on column public.profiles.shoes_staples is 'Comma-separated product IDs (as text) for staple shoes';

commit;


