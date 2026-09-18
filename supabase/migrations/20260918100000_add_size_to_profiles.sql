-- Size the user usually wears: xs, s, m, l, xl, xxl or 'unknown'. A PDP size hint, never a catalog filter.
alter table public.profiles add column if not exists size text;
