export type PipelineState =
  | 'pending'
  | 'scraping'
  | 'identifying'
  | 'awaiting_hitl_identification'
  | 'generating_garment_summary'
  | 'generating_vton'
  | 'segmenting'
  | 'segmented'
  | 'awaiting_hitl_segmentation'
  | 'placement'
  | 'completed'
  | 'failed'
  | 'discarded'
  | 'cancelled';

export interface IngestionPipelineJob {
  job_id: string;
  product_url: string;
  dedupe_key: string | null;
  product_gender_type: 'male' | 'female' | 'unisex';
  product_type: 'topwear' | 'bottomwear' | 'dress';
  product_sub_type: string;
  product_complexity: string;
  v_ton_model: string | null;
  v_ton_image_preference: { type: string } | null;
  hitl_post_identification: boolean;
  hitl_post_segmentation: boolean;
  current_state: PipelineState;
  v_ton_preferred_image: string | null;
  vton_image_url: string | null;
  segmented_image_url: string | null;
  ingested_product_id: string | null;
  error_count: number;
  last_error: string | null;
  last_error_step: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineStepArtifact {
  id: string;
  job_id: string;
  step_name: string;
  artifact_type: string;
  storage_path: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface StepHandler {
  validate(job: IngestionPipelineJob): Promise<void>;
  execute(job: IngestionPipelineJob): Promise<void>;
}

export interface SegmentationStepInput {
  jobId: string;
  segJobId: string;
  inputImageUrl: string;
  stepConfig: Record<string, unknown>;
  priorResults: SegmentationStepOutput[];
}

export interface SegmentationStepOutput {
  stepName: string;
  outputImageUrl: string;
  maskUrl?: string;
  metadata: {
    modelVersion?: string;
    inferenceMs?: number;
    confidence?: number;
    [key: string]: unknown;
  };
}

export interface SegmentationStep {
  name: string;
  run(input: SegmentationStepInput): Promise<SegmentationStepOutput>;
}

export interface TryonInput {
  imageUrl: string;
  gender: string;
  productType: string;
  productSubType: string;
  techPack: string;
  garmentPhysics: string;
  itemName: string;
  colorAndFabric: string;
}

export interface TryonOutput {
  imageUrl: string;
  storagePath: string;
  inferenceMs: number;
  modelUsed: string;
}

export interface TryonProvider {
  name: string;
  run(input: TryonInput): Promise<TryonOutput>;
}
