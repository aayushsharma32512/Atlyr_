import { supabaseAdmin } from '../db/supabase';
import { config } from '../config/index';
import { createLogger } from './logger';

const logger = createLogger({ stage: 'storage' });

export async function ensureBucketExists(): Promise<void> {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === config.STORAGE_BUCKET);
  if (exists) return;

  const { error } = await supabaseAdmin.storage.createBucket(config.STORAGE_BUCKET, {
    public: true,
    fileSizeLimit: 20 * 1024 * 1024,
  });

  if (error) throw new Error(`Failed to create storage bucket: ${error.message}`);
  logger.info({ bucket: config.STORAGE_BUCKET }, 'storage bucket created');
}
