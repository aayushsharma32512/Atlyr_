import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index';

export const supabaseAdmin = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
