import type { DownloadedImageMetaT, ExtractDraftImageT } from './contracts';

export type PauseResumeSignal =
  | {
      action: 'resume';
      actor: 'phase1' | 'phase2' | 'automation' | 'manual';
      data?: Record<string, unknown>;
    }
  | {
      action: 'rerun';
      node: string;
      data?: Record<string, unknown>;
    };

export type PipelineState = {
  jobId: string;
  originalUrl: string;
  domain: string;
  dedupeKey: string;
  productId?: string;

  step?: string;
  timestamps?: Record<string, string>;
  pause?:
    | {
        reason: 'hitl_phase1' | 'hitl_phase2' | 'manual' | 'regeneration';
        atNode: string;
        requestedAt: string;
        metadata?: Record<string, unknown>;
        resumeSignal?: PauseResumeSignal | null;
      }
    | null;

  artifacts?: {
    htmlPath?: string;
    rawHtmlPath?: string;
    jsonPath?: string;
    jsonldPath?: string;
    metaPath?: string;
    extractPath?: string;
    draftImages?: ExtractDraftImageT[];
    rawImages?: DownloadedImageMetaT[];
    imageClassifications?: Array<{
      hash: string;
      storagePath: string;
      kind: 'flatlay' | 'model' | 'detail';
      confidence: number;
      classifierVersion?: string;
    }>;
    imageUrls?: string[];
    crawlMeta?: Record<string, unknown>;
    garmentSummaryRuns?: Array<{
      view: 'front' | 'back';
      provider: 'gemini';
      model: string;
      createdAt: string;
      promptVersion?: string;
    }>;
    garmentSummaryPayloads?: Array<{
      view: 'front' | 'back';
      model: string;
      promptVersion?: string;
      createdAt: string;
      tech_pack?: string;
      garment_physics?: string;
      shoe_physics?: string;
      item_name?: string;
      color_and_fabric?: string;
      raw?: string;
    }>;
    enrichRuns?: Array<{
      provider: 'gemini';
      model: string;
      createdAt: string;
      promptVersion?: string;
    }>;
    ghostImages?: Array<{
      view: 'front' | 'back';
      storagePath: string;
      provider: 'gemini' | 'imagen-2.5';
      model: string;
      createdAt: string;
      seed?: number;
      aspectRatio?: string;
      avatarAssetPath?: string;
      promptVersion?: string;
    }>;
    capabilities?: {
      ghostBackEnabled?: boolean;
    };
  };

  flags?: {
    submitReceived?: boolean;
    downloadReady?: boolean;
    classifyReady?: boolean;
    ghostReady?: boolean;
    bgReady?: boolean;
    imagesReady?: boolean;
    garmentSummaryReady?: boolean;
    enrichReady?: boolean;
    hitlPhase1Completed?: boolean;
    hitlPhase2Completed?: boolean;
    stageCompleted?: boolean;
    promoteCompleted?: boolean;
    cancelled?: boolean;
  };

  processed?: {
    flatlays?: string[] | Record<string, string>;       // processed/ghost_mannequins
    productImages?: string[] | Record<string, string>;  // processed/product_images
  };

  draft?: {
    product?: Record<string, unknown>;
    productSuggestions?: Record<string, unknown>;
    images?: Array<Record<string, unknown>>;
    validations?: Array<{ code: string; message: string }>;
    confidences?: Record<string, number>;
  };

  review?: {
    approved?: boolean;
    decisions?: {
      product?: Record<string, unknown>;
      images?: Array<{ url: string; kind: string; isPrimary: boolean; vtoEligible: boolean; sortOrder: number }>;
    };
  };

  errors?: Array<{ step: string; message: string; kind?: 'transient' | 'user' | 'fatal' }>;
};
