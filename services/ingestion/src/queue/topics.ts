export const TOPICS = {
  CRAWL: 'crawl',
  EXTRACT: 'extract',
  DOWNLOAD: 'download',
  CLASSIFY: 'classify',
  GHOST: 'ghost',
  BGREMOVE: 'bgremove',
  UPLOAD: 'upload',
  ENRICH: 'enrich',
  NORMALIZE: 'normalize',
  REVIEW_PAUSE: 'review-pause',
  STAGE: 'stage',
  PROMOTE: 'promote',
  ORCHESTRATOR: 'ingestion-orchestrator'
} as const;

export type Topic = typeof TOPICS[keyof typeof TOPICS];
