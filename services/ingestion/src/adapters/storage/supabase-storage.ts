import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../db/supabase';
import { config } from '../../config/index';

export async function ensureBucketExists() {
  // Attempt to create the bucket; ignore conflict errors
  const { error } = await supabaseAdmin.storage.createBucket(config.STORAGE_BUCKET, {
    public: config.STORAGE_PUBLIC_URLS
  });
  if (error && !String(error.message || error).toLowerCase().includes('already exists')) {
    throw error;
  }
}

export async function uploadArtifact(jobId: string, name: string, content: string, contentType: string) {
  const path = `artifacts/pages/${jobId}/${name}`;
  const payload = Buffer.from(content, 'utf8');
  const { data, error } = await supabaseAdmin.storage.from(config.STORAGE_BUCKET).upload(path, payload, {
    contentType,
    upsert: true
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[storage:upload:error]', {
      path,
      name,
      message: error.message,
      nameError: error.name,
      status: (error as any).status ?? (error as any).statusCode,
      error: error,
      cause: (error as any).cause
    });
    throw error;
  }
  // eslint-disable-next-line no-console
  console.info('[storage:upload:ok]', { path, size: payload.length, data });
  return path;
}

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

function guessExtension(contentType?: string): string {
  if (!contentType) return 'jpg';
  const lowered = contentType.toLowerCase().split(';')[0]?.trim();
  return MIME_EXTENSION_MAP[lowered] ?? 'jpg';
}

function sanitizeFilename(name: string | undefined, fallbackBase: string): string {
  const raw = (name ?? '').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
  return raw.length > 0 ? raw : fallbackBase;
}

export async function uploadRawImage(jobId: string, hash: string, buffer: Buffer, contentType: string) {
  const ext = guessExtension(contentType);
  const path = `${config.RAW_PREFIX}/${jobId}/${hash}.${ext}`;
  const payload = buffer;
  const { data, error } = await supabaseAdmin.storage.from(config.STORAGE_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[storage:upload-raw:error]', {
      path,
      message: error.message,
      name: error.name,
      status: (error as any).status ?? (error as any).statusCode,
      cause: (error as any).cause
    });
    throw error;
  }
  // eslint-disable-next-line no-console
  console.info('[storage:upload-raw:ok]', { path, size: payload.length, data });
  return path;
}

export async function getArtifactJson(path: string): Promise<any> {
  const { data, error } = await supabaseAdmin.storage.from(config.STORAGE_BUCKET).download(path);
  if (error) {
    let bodyText: string | undefined;
    const orig: any = (error as any).originalError;
    if (orig && typeof orig.text === 'function') {
      try { bodyText = await orig.text(); } catch { bodyText = undefined; }
    }
    // eslint-disable-next-line no-console
    console.error('[storage:download:error]', {
      path,
      message: error.message,
      name: error.name,
      status: (error as any).status ?? (error as any).statusCode,
      error,
      cause: (error as any).cause,
      isStorageError: Boolean((error as any).__isStorageError),
      body: bodyText
    });
    throw error;
  }
  // eslint-disable-next-line no-console
  console.info('[storage:download:ok]', { path, type: data?.constructor?.name });
  if (!data) return {};

  let text: string;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    text = await data.text();
  } else if (data instanceof ArrayBuffer) {
    text = Buffer.from(data).toString('utf8');
  } else if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    text = Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('utf8');
  } else {
    // fallback for node streams/buffers
    text = Buffer.from(data as any).toString('utf8');
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function downloadStorageFile(path: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  const { data, error } = await supabaseAdmin.storage.from(config.STORAGE_BUCKET).download(path);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[storage:download-file:error]', {
      path,
      message: error.message,
      name: error.name,
      status: (error as any).status ?? (error as any).statusCode,
      cause: (error as any).cause
    });
    throw error;
  }

  if (!data) {
    throw new Error(`storage-file-empty:${path}`);
  }

  let buffer: Buffer;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const arrayBuffer = await data.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else if (data instanceof ArrayBuffer) {
    buffer = Buffer.from(data);
  } else if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    buffer = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  } else {
    buffer = Buffer.from(data as any);
  }

  const contentType = (data as any)?.type ?? null;
  return { buffer, contentType };
}

export async function uploadGhostStagingImage(jobId: string, view: 'front' | 'back', buffer: Buffer, contentType: string) {
  const ext = guessExtension(contentType);
  const filename = `${Date.now()}-${randomUUID()}.${ext}`;
  const path = `${config.STAGING_GM_PREFIX}/${jobId}/${view}/${filename}`;

  const { data, error } = await supabaseAdmin.storage.from(config.STORAGE_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[storage:upload-ghost-staging:error]', {
      path,
      message: error.message,
      name: error.name,
      status: (error as any).status ?? (error as any).statusCode,
      cause: (error as any).cause
    });
    throw error;
  }

  // eslint-disable-next-line no-console
  console.info('[storage:upload-ghost-staging:ok]', { path, size: buffer.length, data });
  return path;
}

export async function uploadGhostProcessedImage(params: { jobId: string; view: 'front' | 'back'; filename?: string; buffer: Buffer; contentType: string }) {
  const { jobId, view, filename, buffer, contentType } = params;
  const ext = guessExtension(contentType);
  const safeBase = sanitizeFilename(filename, `ghost-${view}`);
  const safeName = safeBase.includes('.') ? safeBase : `${safeBase}.${ext}`;
  const path = `${config.PROCESSED_GM_PREFIX}/${jobId}/${view}/${Date.now()}-${safeName}`;

  const { data, error } = await supabaseAdmin.storage.from(config.STORAGE_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[storage:upload-ghost-processed:error]', {
      path,
      message: error.message,
      name: error.name,
      status: (error as any).status ?? (error as any).statusCode,
      cause: (error as any).cause
    });
    throw error;
  }

  // eslint-disable-next-line no-console
  console.info('[storage:upload-ghost-processed:ok]', { path, size: buffer.length, data });
  return path;
}
