import { supabaseAdmin } from '../db/supabase';
import { config } from '../config/index';

export async function uploadToSupabase(
  path: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  const { error } = await supabaseAdmin.storage
    .from(config.STORAGE_BUCKET)
    .upload(path, body, { contentType, upsert: true });

  if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);

  return getPublicUrl(path);
}

export function getPublicUrl(path: string): string {
  const { data } = supabaseAdmin.storage
    .from(config.STORAGE_BUCKET)
    .getPublicUrl(path);
  return data.publicUrl;
}
