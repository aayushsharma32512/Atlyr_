export const STATE_LABELS: Record<string, string> = {
  pending:                      'Pending',
  scraping:                     'Scraping',
  scraped:                      'Scraped',
  identifying:                  'Identifying',
  identified:                   'Identified',
  awaiting_hitl_identification: 'Review: Identification',
  generating_garment_summary:   'Generating Summary',
  garment_summary_generated:    'Summary Ready',
  generating_vton:              'Generating VTon',
  vton_generated:               'VTon Ready',
  segmenting:                   'Segmenting',
  segmented:                    'Segmented',
  awaiting_hitl_segmentation:   'Review: Segmentation',
  // Manual asset lane (footwear). Each label names the file the operator owes, because the row's
  // whole purpose is telling a human what to do next.
  awaiting_manual_identification: 'Pick photo',
  awaiting_manual_vton:           'Upload try-on',
  awaiting_manual_segmentation:   'Upload cut-out',
  awaiting_manual_placement:      'Place on mannequin',
  placement:                    'Placing',
  completed:                    'Completed',
  failed:                       'Failed',
  discarded:                    'Discarded',
  cancelled:                    'Cancelled',
}

export type StateVariant = 'default' | 'secondary' | 'outline' | 'destructive'

export const STATE_VARIANTS: Record<string, StateVariant> = {
  pending:                      'outline',
  scraping:                     'secondary',
  scraped:                      'secondary',
  identifying:                  'secondary',
  identified:                   'secondary',
  awaiting_hitl_identification: 'default',
  generating_garment_summary:   'secondary',
  garment_summary_generated:    'secondary',
  generating_vton:              'secondary',
  vton_generated:               'secondary',
  segmenting:                   'secondary',
  segmented:                    'secondary',
  awaiting_hitl_segmentation:   'default',
  // 'default' is the attention variant — every manual gate is blocked on a person.
  awaiting_manual_identification: 'default',
  awaiting_manual_vton:           'default',
  awaiting_manual_segmentation:   'default',
  awaiting_manual_placement:      'default',
  placement:                    'default',
  completed:                    'outline',
  failed:                       'destructive',
  discarded:                    'outline',
  cancelled:                    'outline',
}

export const ACTIVE_STATES = new Set([
  'pending', 'scraping', 'scraped', 'identifying', 'identified',
  'generating_garment_summary', 'garment_summary_generated',
  'generating_vton', 'vton_generated', 'segmenting', 'segmented',
  // Economy lane: parked in an AI Studio batch tray. Active work — just work happening at Google
  // rather than here.
  'vton_batch_queued',
])

export const AWAITING_STATES = new Set([
  'awaiting_hitl_identification',
  'awaiting_hitl_segmentation',
  // Not ACTIVE_STATES: a manual gate is not work in flight, it is work waiting on a person. Put
  // one in ACTIVE by mistake and the row spins forever instead of asking for its file.
  'awaiting_manual_identification',
  'awaiting_manual_vton',
  'awaiting_manual_segmentation',
  'awaiting_manual_placement',
  'placement',
])

export const TERMINAL_STATES = new Set(['completed', 'failed', 'discarded', 'cancelled'])

// States the restart endpoint accepts
export const RESTARTABLE_STATES = [
  'scraping',
  'identifying',
  'generating_garment_summary',
  'generating_vton',
  'segmenting',
  'placement',
] as const

export const RESTARTABLE_STATE_LABELS: Record<string, string> = {
  scraping:                   'Scraping — re-scrape URL, re-download images',
  identifying:                'Identifying — re-run SigLIP classification',
  generating_garment_summary: 'Garment Summary — re-run Gemini',
  generating_vton:            'VTon Generation — re-generate try-on image',
  segmenting:                 'Segmentation — re-run full segmentation pipeline',
  placement:                  'Placement — re-run garment placement pipeline',
}

// Step order used to determine impact of restart
export const STEP_ORDER = [
  'scraping', 'identifying', 'generating_garment_summary',
  'generating_vton', 'segmenting', 'placement',
] as const

