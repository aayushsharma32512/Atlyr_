import { z } from 'zod';

// Queue topics (logical steps in the pipeline)
export const Topics = {
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
  PROMOTE: 'promote'
} as const;
export type Topic = typeof Topics[keyof typeof Topics];

// Core payload carried across all topics
export const CorePayload = z.object({
  jobId: z.string().uuid(),
  originalUrl: z.string().url(),
  domain: z.string().min(1),
  dedupeKey: z.string().min(8),
  productId: z.string().optional()
});
export type CorePayloadT = z.infer<typeof CorePayload>;

// CRAWL
export const CrawlPayload = CorePayload.extend({
  strategy: z.enum(['firecrawl', 'playwright']).default('firecrawl'),
  robotsChecked: z.boolean().default(true)
});
export type CrawlPayloadT = z.infer<typeof CrawlPayload>;

export const CrawlOutput = z.object({
  finalUrl: z.string().url(),
  artifactRefs: z.object({
    // scrape mode
    jsonPath: z.string().optional(),
    metaPath: z.string().optional(),
    htmlPath: z.string().optional(),
    rawHtmlPath: z.string().optional(),
    // extract mode
    extractPath: z.string().optional()
  }),
  imageUrls: z.array(z.string().url()).default([]),
  crawl_meta: z.record(z.string(), z.any()).optional()
});
export type CrawlOutputT = z.infer<typeof CrawlOutput>;

// EXTRACT (deterministic, no LLM)
export const ExtractPayload = CorePayload.extend({
  artifactRefs: z.object({
    htmlPath: z.string().optional(),
    rawHtmlPath: z.string().optional(),
    jsonPath: z.string().optional(),
    jsonldPath: z.string().optional(),
    metaPath: z.string().optional(),
    extractPath: z.string().optional()
  })
});
export type ExtractPayloadT = z.infer<typeof ExtractPayload>;

export const ExtractOutput = z.object({
  identity: z.object({
    product_url: z.string().url(),
    product_name: z.string().min(1).optional(),
    brand: z.string().min(1).optional(),
    sku_or_slug: z.string().optional(),
    retailer_product_id: z.string().optional()
  }),
  commercials: z.object({
    price_minor: z.number().int().optional(),
    currency: z.string().length(3).optional(),
    availability_status: z.enum(['in_stock', 'out_of_stock', 'unknown']).default('unknown')
  }),
  presentation: z.object({
    raw_description: z.string().optional(),
    bullets_raw: z.array(z.string()).default([]),
    breadcrumbs: z.array(z.string()).default([]),
    meta_title: z.string().optional(),
    meta_tags: z.array(z.string()).default([])
  }),
  typing_hints: z.object({
    type_category_hint: z.string().optional(),
    gender_hint: z.enum(['male', 'female', 'unisex']).optional(),
    category_slug_hint: z.string().optional()
  }),
  color_size: z.object({
    color: z.string().optional(),
    color_variants_raw: z.array(z.record(z.string(), z.any())).default([]),
    size_options_raw: z.array(z.string()).default([]),
    size_guide_url: z.string().url().optional()
  }),
  media: z.object({
    image_urls: z.array(z.string().url()).default([]),
    primary_image_hint: z.string().url().optional(),
    detail_images_present: z.boolean().optional()
  }),
  provenance: z.object({
    last_crawled_at: z.string().optional()
  }).optional()
});
export type ExtractOutputT = z.infer<typeof ExtractOutput>;

// Extract draft (ingestion-ready)
export const ExtractDraftProduct = z.object({
  id: z.string(),
  type: z.enum(['top', 'bottom', 'shoes', 'accessory', 'occasion']).nullable().optional(),
  brand: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  price: z.number().int().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  product_url: z.string().url(),
  gender: z.string().nullable().optional(),
  product_name: z.string().nullable().optional(),
  type_category: z.string().nullable().optional(),
  color_group: z.string().nullable().optional(),
  occasion: z.string().nullable().optional(),
  material_type: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
  size_chart: z.record(z.string(), z.any()).nullable().optional(),
  description_text: z.string().nullable().optional(),
  vibes: z.string().nullable().optional(),
  fit: z.string().nullable().optional(),
  feel: z.string().nullable().optional(),
  garment_summary: z.record(z.string(), z.any()).nullable().optional(),
  garment_summary_front: z.record(z.string(), z.any()).nullable().optional(),
  garment_summary_back: z.record(z.string(), z.any()).nullable().optional(),
  garment_summary_version: z.string().nullable().optional(),
  material: z.string().nullable().optional(),
  care: z.string().nullable().optional(),
  product_specifications: z.record(z.string(), z.any()).nullable().optional(),
  image_length: z.number().nullable().optional(),
  product_length: z.number().nullable().optional(),
  placement_x: z.number().nullable().optional(),
  placement_y: z.number().nullable().optional(),
  body_parts_visible: z.array(z.string()).nullable().optional(),
  similar_items: z.string().nullable().optional(),
  vector_embedding: z.array(z.number()).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional()
});

export const ProductView = z.enum(['front', 'back', 'side', 'detail', 'other']);

export const ExtractDraftImage = z.object({
  product_id: z.string(),
  url: z.string().url(),
  kind: z.enum(['flatlay', 'model', 'detail']).nullable(),
  is_primary: z.boolean().default(false),
  sort_order: z.number().int(),
  gender: z.string().nullable(),
  vto_eligible: z.boolean(),
  product_view: ProductView.nullable().default(null),
  ghost_eligible: z.boolean().default(false),
  summary_eligible: z.boolean().default(false)
});
export type ExtractDraftImageT = z.infer<typeof ExtractDraftImage>;

export const ExtractDraftOutput = z.object({
  draft_product: ExtractDraftProduct,
  draft_images: z.array(ExtractDraftImage),
  validations: z.array(z.object({ code: z.string(), message: z.string() })).default([])
});
export type ExtractDraftOutputT = z.infer<typeof ExtractDraftOutput>;

// DOWNLOADER
export const DownloadPayload = CorePayload.extend({
  artifactRefs: z.object({
    extractedPath: z.string()
  }),
  retryUrls: z.array(z.string()).default([])
});
export type DownloadPayloadT = z.infer<typeof DownloadPayload>;

export const DownloadedImageMeta = z.object({
  originalUrl: z.string().url(),
  storagePath: z.string(),
  hash: z.string().min(16),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sortOrder: z.number().int(),
  isPrimarySuggestion: z.boolean(),
  kindHint: z.enum(['flatlay', 'model', 'detail']).nullable().optional(),
  genderHint: z.string().nullable().optional(),
  vtoEligibleHint: z.boolean().optional(),
  productId: z.string(),
  downloadedAt: z.string(),
  productView: ProductView.nullable().optional(),
  ghostEligible: z.boolean().optional(),
  summaryEligible: z.boolean().optional()
});
export type DownloadedImageMetaT = z.infer<typeof DownloadedImageMeta>;

export const DownloadOutput = z.object({
  images: z.array(DownloadedImageMeta)
});
export type DownloadOutputT = z.infer<typeof DownloadOutput>;

// CLASSIFY (image kinds)
export const ClassifyPayload = CorePayload.extend({
  images: z.array(z.object({
    storagePath: z.string(),
    hash: z.string().min(16),
    originalUrl: z.string().url(),
    sortOrder: z.number().int(),
    isPrimarySuggestion: z.boolean(),
    kindHint: z.enum(['flatlay', 'model', 'detail']).nullable().optional(),
    genderHint: z.string().nullable().optional(),
    vtoEligibleHint: z.boolean().optional()
  })),
  modelVersion: z.string().default('clip-zero-shot')
});
export type ClassifyPayloadT = z.infer<typeof ClassifyPayload>;

export const ClassifyOutput = z.object({
  image_kinds: z.array(z.object({
    url: z.string().url(),
    kind: z.enum(['flatlay', 'model', 'detail']),
    confidence: z.number().min(0).max(1)
  }))
});
export type ClassifyOutputT = z.infer<typeof ClassifyOutput>;

// GHOST (ghost mannequin)
export const GhostPayload = CorePayload.extend({
  flatlayRefs: z.array(z.string().url()),
  imageHashes: z.array(z.string().min(16))
});
export type GhostPayloadT = z.infer<typeof GhostPayload>;

export const GhostOutput = z.object({
  ghostRefs: z.array(z.string().url()),
  provider_job_ids: z.array(z.string()).optional()
});
export type GhostOutputT = z.infer<typeof GhostOutput>;

// BGREMOVE (background removal)
export const BgRemovePayload = CorePayload.extend({
  ghostRefs: z.array(z.string().url()),
  params: z.object({ provider: z.enum(['clipdrop', 'rembg']).default('clipdrop') })
});
export type BgRemovePayloadT = z.infer<typeof BgRemovePayload>;

export const BgRemoveOutput = z.object({
  processed_flatlays: z.array(z.string().url()),
  quality: z.record(z.string(), z.any()).optional(),
  crop_meta: z.record(z.string(), z.any()).optional()
});
export type BgRemoveOutputT = z.infer<typeof BgRemoveOutput>;

// UPLOAD (finalize storage references)
export const UploadPayload = CorePayload.extend({
  rawRefs: z.array(z.string().url()).default([]),
  ghostRefs: z.array(z.string().url()).default([]),
  processedRefs: z.array(z.string().url()).default([])
});
export type UploadPayloadT = z.infer<typeof UploadPayload>;

export const UploadOutput = z.object({
  storage_confirmations: z.array(z.string().url())
});
export type UploadOutputT = z.infer<typeof UploadOutput>;

// ENRICH (multimodal garment details + vibes + size_chart)
export const EnrichPayload = CorePayload.extend({
  baseFields: z.record(z.string(), z.any()).default({}),
  selectedImageRefs: z.array(z.string().url()).default([]),
  promptVersion: z.string().default('v1')
});
export type EnrichPayloadT = z.infer<typeof EnrichPayload>;

export const EnrichOutput = z.object({
  garment_summary: z.record(z.string(), z.any()).optional(),
  size_chart: z.record(z.string(), z.any()).optional(),
  size_chart_asset_url: z.string().url().optional(),
  type_category: z.string().optional(),
  color_group: z.string().optional(),
  occasion: z.string().optional(),
  material_type: z.string().optional(),
  target_gender: z.enum(['male', 'female', 'unisex']).optional(),
  fit: z.union([z.array(z.string()), z.string()]).optional(),
  feel: z.union([z.array(z.string()), z.string()]).optional(),
  description_text: z.string().optional(),
  vibes: z.union([z.array(z.string()), z.string()]).optional(),
  confidences: z.record(z.string(), z.number()).optional()
});
export type EnrichOutputT = z.infer<typeof EnrichOutput>;

// NORMALIZE (merge EXTRACT + ENRICH into drafts)
export const NormalizePayload = CorePayload.extend({
  mappingHints: z.record(z.string(), z.any()).default({}),
  currencyLocale: z.string().default('en-IN'),
  proposedPrimary: z.string().url().optional(),
  proposedOrder: z.array(z.string().url()).optional()
});
export type NormalizePayloadT = z.infer<typeof NormalizePayload>;

export const DraftProduct = ExtractDraftProduct.extend({
  item_type: z.enum(['top', 'bottom', 'shoes', 'accessory', 'occasion']).nullable().optional(),
  price_minor: z.number().int().nullable().optional(),
  category_ghost: z.enum(['topwear', 'bottomwear', 'footwear', 'dresses']).nullable().optional()
});

export const DraftImage = z.object({
  product_id: z.string(),
  url: z.string().url(),
  kind: z.enum(['flatlay', 'model', 'detail']),
  is_primary: z.boolean().default(false),
  sort_order: z.number().int(),
  vto_eligible: z.boolean().default(false),
  product_view: ProductView.nullable().default(null),
  ghost_eligible: z.boolean().default(false),
  summary_eligible: z.boolean().default(false),
  storage_path: z.string().nullable().optional()
});

export const NormalizeOutput = z.object({
  draft_product: DraftProduct,
  draft_images: z.array(DraftImage),
  validations: z.array(z.object({ code: z.string(), message: z.string() })).default([]),
  confidences: z.record(z.string(), z.number()).default({})
});
export type NormalizeOutputT = z.infer<typeof NormalizeOutput>;

// REVIEW decisions (HITL)
export const ReviewDecision = z.object({
  productEdits: z.record(z.string(), z.any()),
  images: z.array(z.object({
    url: z.string().url(),
    kind: z.enum(['flatlay', 'model', 'detail']),
    isPrimary: z.boolean(),
    vtoEligible: z.boolean().default(false),
    sortOrder: z.number().int()
  }))
});
export type ReviewDecisionT = z.infer<typeof ReviewDecision>;

export const Phase1UpdatePayload = z.object({
  patch: z
    .object({
      draft: z
        .object({
          product: DraftProduct.partial().optional(),
          images: z
            .array(
              z.object({
                url: z.string().url(),
                product_view: z.enum(['front', 'back', 'side', 'detail', 'other']).nullable().optional(),
                ghost_eligible: z.boolean().optional(),
                summary_eligible: z.boolean().optional(),
                vto_eligible: z.boolean().optional(),
                is_primary: z.boolean().optional(),
                sort_order: z.number().int().optional(),
                product_id: z.string().optional(),
                gender: z.string().nullable().optional(),
                kind: z.enum(['flatlay', 'model', 'detail']).nullable().optional(),
                storage_path: z.string().nullable().optional()
              })
            )
            .optional(),
          validations: z.array(z.object({ code: z.string(), message: z.string() })).optional()
        })
        .optional(),
      artifacts: z
        .object({
          rawImages: z.any().optional(),
          imageClassifications: z.any().optional()
        })
        .partial()
        .optional(),
      flags: z
        .object({
          hitlPhase1Completed: z.boolean().optional()
        })
        .partial()
        .optional()
    })
    .partial()
    .optional(),
  complete: z.boolean().optional(),
  resumeData: z.record(z.string(), z.any()).optional()
});
export type Phase1UpdatePayloadT = z.infer<typeof Phase1UpdatePayload>;

export const Phase2UpdatePayload = z.object({
  patch: z
    .object({
      draft: z
        .object({
          product: DraftProduct.partial().optional(),
          images: z
            .array(
              z.object({
                url: z.string().url(),
                product_view: z.enum(['front', 'back', 'side', 'detail', 'other']).nullable().optional(),
                ghost_eligible: z.boolean().optional(),
                summary_eligible: z.boolean().optional(),
                vto_eligible: z.boolean().optional(),
                is_primary: z.boolean().optional(),
                sort_order: z.number().int().optional(),
                product_id: z.string().optional(),
                gender: z.string().nullable().optional(),
                kind: z.enum(['flatlay', 'model', 'detail']).nullable().optional(),
                storage_path: z.string().nullable().optional()
              })
            )
            .optional()
        })
        .optional(),
      artifacts: z
        .object({
          rawImages: z.any().optional(),
          imageClassifications: z.any().optional()
        })
        .partial()
        .optional(),
      flags: z
        .object({
          hitlPhase2Completed: z.boolean().optional()
        })
        .partial()
        .optional(),
      review: z
        .object({
          approved: z.boolean().optional()
        })
        .partial()
        .optional()
    })
    .partial()
    .optional(),
  action: z.enum(['approve', 'regenerate']).optional(),
  node: z.enum(['ghost', 'garment_summary', 'enrich']).optional(),
  data: z.record(z.string(), z.any()).optional()
});
export type Phase2UpdatePayloadT = z.infer<typeof Phase2UpdatePayload>;

// STAGE / PROMOTE payloads
export const StagePayload = CorePayload.extend({
  approvedPayload: z.object({
    product: DraftProduct,
    images: z.array(DraftImage)
  })
});
export type StagePayloadT = z.infer<typeof StagePayload>;

export const PromotePayload = StagePayload;
export type PromotePayloadT = z.infer<typeof PromotePayload>;
