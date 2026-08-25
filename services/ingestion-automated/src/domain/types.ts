export type PipelineState =
  | 'pending'
  | 'scraping'
  | 'identifying'
  | 'awaiting_hitl_identification'
  | 'generating_garment_summary'
  | 'generating_vton'
  // Parked: the VTON step is out with an AI Studio batch tray. Nothing in this service drives a
  // job in this state — the poller resumes it when results come back, or demotes it to the
  // instant lane. See docs/economy-lane-batch-vton.md.
  | 'vton_batch_queued'
  | 'segmenting'
  | 'segmented'
  | 'awaiting_hitl_segmentation'
  // The manual asset lane's four gates. Each waits on an operator and is resumed by
  // POST /jobs/:id/proceed, exactly like the awaiting_hitl_* pair above. Introduced in
  // supabase/migrations/20260825140000_add_manual_asset_lane.sql.
  | 'awaiting_manual_identification'
  | 'awaiting_manual_vton'
  | 'awaiting_manual_segmentation'
  | 'awaiting_manual_placement'
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
  product_type: 'topwear' | 'bottomwear' | 'dress' | 'footwear';
  product_sub_type: string;
  product_complexity: string;
  v_ton_model: string | null;
  v_ton_image_preference: { type: string } | null;
  hitl_post_identification: boolean;
  hitl_post_segmentation: boolean;
  current_state: PipelineState;
  /** Which lane this job's VTON step takes. 'instant' is the default and the only lane for FASHN jobs. */
  vton_lane: 'instant' | 'batch';
  /**
   * Which lane produces this job's VTON and segmented images. 'automated' runs the normal
   * pipeline; 'manual' replaces the identification, VTON, segmentation and placement steps with
   * operator gates. Read by the `scraping` transition, so it must survive every `{...job}` spread
   * on the path to that fork — nextState() reads the in-memory object, never the DB.
   */
  asset_lane: 'automated' | 'manual';
  /** The batch tray currently owning this job, or null when unclaimed. */
  gemini_batch_id: string | null;
  v_ton_preferred_image: string | null;
  vton_image_url: string | null;
  segmented_image_url: string | null;
  ingested_product_id: string | null;
  error_count: number;
  last_error: string | null;
  last_error_step: string | null;
  created_by: string | null;
  /** Set when the job was created through POST /batches; null for manual submissions. */
  batch_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngestionBatch {
  batch_id: string;
  label: string;
  created_by: string | null;
  total: number;
  created_at: string;
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
  bytes: Buffer;
  mimeType: string;
  inferenceMs: number;
  modelUsed: string;
  /** Transport route that served the call (e.g. 'ai_studio', 'vertex:global'). Gemini provider only. */
  routeUsed?: string;
  /** Failed route/model attempts before the one that succeeded — persisted for the dashboard. */
  attempted?: Array<{ route: string; model: string; errorKind: string; ms: number; message: string }>;
  /** Token counts from the provider, when it reports them — used for exact cost accounting. */
  usage?: { prompt_tokens: number; output_tokens: number; total_tokens: number } | null;
}

export interface TryonProvider {
  name: string;
  run(input: TryonInput): Promise<TryonOutput>;
}
