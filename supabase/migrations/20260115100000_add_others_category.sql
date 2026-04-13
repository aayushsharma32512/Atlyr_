INSERT INTO public.categories (id, name, slug)
VALUES ('others', 'Others', 'others')
ON CONFLICT DO NOTHING;
