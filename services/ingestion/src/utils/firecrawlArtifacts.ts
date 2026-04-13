import { uploadArtifact } from '../adapters/storage/supabase-storage';
import type { FirecrawlResult } from '../adapters/crawler/firecrawl';

export async function persistFirecrawlArtifacts(params: {
  jobId: string;
  mode: 'scrape' | 'extract';
  result: FirecrawlResult;
}): Promise<Record<string, string>> {
  const { jobId, mode, result } = params;

  if (mode === 'extract') {
    const extractPath = await uploadArtifact(jobId, `${jobId}.extract.json`, JSON.stringify(result.json ?? {}), 'application/json');
    return { extractPath };
  }

  const refs: Record<string, string> = {};

  refs.jsonPath = await uploadArtifact(jobId, `${jobId}.json`, JSON.stringify(result.json ?? {}), 'application/json');

  if (typeof result.html === 'string' && result.html.trim().length > 0) {
    refs.htmlPath = await uploadArtifact(jobId, `${jobId}.html`, result.html, 'text/html');
  }
  if (typeof result.rawHtml === 'string' && result.rawHtml.trim().length > 0) {
    refs.rawHtmlPath = await uploadArtifact(jobId, `${jobId}.raw.html`, result.rawHtml, 'text/html');
  }

  if (result.metadata && Object.keys(result.metadata).length > 0) {
    refs.metaPath = await uploadArtifact(jobId, `${jobId}.meta.json`, JSON.stringify(result.metadata), 'application/json');
  }

  return refs;
}
