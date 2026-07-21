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
  placement:                    'Awaiting Placement',
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
])

export const AWAITING_STATES = new Set([
  'awaiting_hitl_identification',
  'awaiting_hitl_segmentation',
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

