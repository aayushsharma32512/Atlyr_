INSERT INTO public.occasions (id, name, slug, background_url, description)
VALUES (
  'others',
  'Others',
  'others',
  '/Backgrounds/8.png',
  'Fallback occasion when no explicit occasion is selected.'
)
ON CONFLICT DO NOTHING;
