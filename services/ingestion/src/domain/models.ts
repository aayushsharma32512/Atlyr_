export type UUID = string;

export interface CoreJobPayload {
  jobId: UUID;
  originalUrl: string;
  domain: string;
  dedupeKey: string;
  productId?: string;
}

export interface CrawlResult {
  finalUrl: string;
  htmlPath?: string;
  jsonldPath?: string;
  metaPath?: string;
  imageUrls: string[];
}

export interface ExtractionResult {
  product: {
    productName?: string;
    brand?: string;
    priceMinor?: number;
    currency?: string;
    color?: string;
    sizes?: string[];
    genderHint?: string;
    productUrl?: string;
    skuOrSlug?: string;
  };
}

export interface PipelineState {
  jobId: UUID;
  originalUrl: string;
  domain: string;
  dedupeKey: string;
  productId?: string;
  step?: string;
  crawl?: CrawlResult;
  extract?: ExtractionResult;
  errors?: { step: string; message: string }[];
}
