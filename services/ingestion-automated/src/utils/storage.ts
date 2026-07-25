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

/**
 * Best-effort recursive removal of everything under a storage prefix (e.g. "<jobId>/"). Supabase
 * .list() is one level deep, so we recurse into subfolders. Never throws — used during job delete.
 */
export async function removeStoragePrefix(prefix: string): Promise<void> {
  const bucket = supabaseAdmin.storage.from(config.STORAGE_BUCKET);
  const normalized = prefix.replace(/\/+$/, '');

  const collect = async (dir: string): Promise<string[]> => {
    const { data, error } = await bucket.list(dir, { limit: 1000 });
    if (error || !data) return [];
    const files: string[] = [];
    for (const entry of data) {
      const full = dir ? `${dir}/${entry.name}` : entry.name;
      // A folder entry has no id/metadata; recurse. Otherwise it's a file.
      if (entry.id === null || entry.metadata === null) {
        files.push(...await collect(full));
      } else {
        files.push(full);
      }
    }
    return files;
  };

  try {
    const files = await collect(normalized);
    if (files.length > 0) await bucket.remove(files);
  } catch {
    // best-effort — leave orphaned files rather than fail the delete
  }
}
