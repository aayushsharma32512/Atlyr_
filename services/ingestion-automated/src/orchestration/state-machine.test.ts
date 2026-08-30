import { test, expect, describe } from 'bun:test';
import {
  hasTransition,
  HITL_STATES,
  NO_ENQUEUE_STATES,
  nextState,
  PARKED_STATES,
  TERMINAL_STATES,
} from './state-machine';
import type { IngestionPipelineJob } from '../domain/types';

function job(overrides: Partial<IngestionPipelineJob> = {}): IngestionPipelineJob {
  return {
    job_id: 'j1',
    product_url: 'https://example.com',
    dedupe_key: null,
    product_gender_type: 'female',
    product_type: 'topwear',
    product_sub_type: 't-shirt',
    product_complexity: 'simple',
    v_ton_model: null,
    v_ton_image_preference: null,
    hitl_post_identification: false,
    hitl_post_segmentation: false,
    current_state: 'generating_garment_summary',
    vton_lane: 'instant',
    asset_lane: 'automated',
    gemini_batch_id: null,
    v_ton_preferred_image: 'https://example.com/img.jpg',
    vton_image_url: null,
    segmented_image_url: null,
    ingested_product_id: null,
    error_count: 0,
    last_error: null,
    last_error_step: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const MANUAL_GATES = [
  'awaiting_manual_identification',
  'awaiting_manual_vton',
  'awaiting_manual_segmentation',
  'awaiting_manual_placement',
] as const;


describe('the manual asset lane fork', () => {
  test('an automated job scrapes into identifying, as it always has', () => {
    expect(nextState(job({ current_state: 'scraping', asset_lane: 'automated' })))
      .toBe('identifying');
  });

  test('a manual job skips identification and parks for the operator', () => {
    expect(nextState(job({ current_state: 'scraping', asset_lane: 'manual' })))
      .toBe('awaiting_manual_identification');
  });

  test('the four gates run in order and end at completed', () => {
    const chain: Array<[IngestionPipelineJob['current_state'], IngestionPipelineJob['current_state']]> = [
      ['awaiting_manual_identification', 'awaiting_manual_vton'],
      ['awaiting_manual_vton', 'awaiting_manual_segmentation'],
      ['awaiting_manual_segmentation', 'awaiting_manual_placement'],
      ['awaiting_manual_placement', 'completed'],
    ];
    for (const [from, to] of chain) {
      expect(nextState(job({ current_state: from, asset_lane: 'manual' }))).toBe(to);
    }
  });

  test('the lane never reaches an automated asset step', () => {
    // The whole point of the lane: no VTON generation, no Modal segmentation. If a future edit
    // routes a manual job into one of these, it will burn GPU on a job whose assets are hand-made.
    const forbidden = ['identifying', 'generating_garment_summary', 'generating_vton', 'segmenting'];
    let state: string = 'scraping';
    const seen: string[] = [state];
    for (let i = 0; i < 10 && state !== 'completed'; i += 1) {
      state = nextState(job({ current_state: state as IngestionPipelineJob['current_state'], asset_lane: 'manual' }));
      seen.push(state);
    }
    expect(state).toBe('completed');
    for (const f of forbidden) expect(seen).not.toContain(f);
  });

  test('the lane disturbs no other edge', () => {
    // Every transition NOT keyed on asset_lane must be identical under both lanes.
    const untouched: Array<IngestionPipelineJob['current_state']> = [
      'pending', 'identifying', 'awaiting_hitl_identification', 'generating_garment_summary',
      'generating_vton', 'segmenting', 'segmented', 'awaiting_hitl_segmentation', 'placement',
    ];
    for (const st of untouched) {
      expect(nextState(job({ current_state: st, asset_lane: 'manual' })))
        .toBe(nextState(job({ current_state: st, asset_lane: 'automated' })));
    }
  });

  test('every gate is a HITL state, so nothing enqueues on entry', () => {
    for (const st of MANUAL_GATES) {
      expect(HITL_STATES).toContain(st);
      expect(NO_ENQUEUE_STATES).toContain(st);
      expect(PARKED_STATES).not.toContain(st);
    }
  });

  test('every gate HAS a transition — the inverse of the parked-state drill', () => {
    // Parked states must NOT have one (they are resumed by replaying a predecessor edge).
    // These are resumed by POST /proceed calling nextState(), so a missing entry would throw
    // 'No transition defined for state: X' at the moment the operator clicks Proceed.
    for (const st of MANUAL_GATES) expect(hasTransition(st)).toBe(true);
  });
});

describe('the economy lane fork', () => {
  test('an instant job goes straight to generating_vton', () => {
    expect(nextState(job({ vton_lane: 'instant' }))).toBe('generating_vton');
  });

  test('a batch job parks', () => {
    expect(nextState(job({ vton_lane: 'batch' }))).toBe('vton_batch_queued');
  });

  test('an unpinned batch job parks — the default provider is the Gemini one', () => {
    expect(nextState(job({ vton_lane: 'batch', v_ton_model: null }))).toBe('vton_batch_queued');
    expect(nextState(job({ vton_lane: 'batch', v_ton_model: 'gemini_nano_banana' }))).toBe('vton_batch_queued');
  });

  // A FASHN-pinned job parked in a Gemini tray would never be collected: the collector only ever
  // builds Gemini requests, so the job would sit parked until the 48h deadline swept it.
  test('a job pinned to a non-Gemini provider never parks, even in the batch lane', () => {
    expect(nextState(job({ vton_lane: 'batch', v_ton_model: 'fashn_vton' }))).toBe('generating_vton');
    expect(nextState(job({ vton_lane: 'batch', v_ton_model: 'seedream' }))).toBe('generating_vton');
  });

  test('the lane does not disturb any other edge', () => {
    expect(nextState(job({ current_state: 'generating_vton', vton_lane: 'batch' }))).toBe('segmenting');
    expect(nextState(job({ current_state: 'segmenting', vton_lane: 'batch' }))).toBe('segmented');
    expect(nextState(job({ current_state: 'pending', vton_lane: 'batch' }))).toBe('scraping');
  });
});

describe('parked states', () => {
  test('the parked VTON state is parked, and is not terminal or HITL', () => {
    expect(PARKED_STATES).toContain('vton_batch_queued');
    expect(TERMINAL_STATES).not.toContain('vton_batch_queued');
    expect(HITL_STATES).not.toContain('vton_batch_queued');
  });

  // advance-and-trigger consults this one list; missing a state here means a message is enqueued
  // for work nothing can perform, which then fails the job.
  test('every parked and HITL state is in the no-enqueue set', () => {
    for (const state of [...PARKED_STATES, ...HITL_STATES]) {
      expect(NO_ENQUEUE_STATES).toContain(state);
    }
  });

  test('no working state leaks into the no-enqueue set', () => {
    for (const state of ['generating_vton', 'segmenting', 'placement', 'scraping'] as const) {
      expect(NO_ENQUEUE_STATES).not.toContain(state);
    }
  });

  // The poller resumes a parked job by replaying the generating_vton edge, so there must be no
  // second, divergent path out of the parked state.
  test('the parked state has no automatic transition', () => {
    expect(hasTransition('vton_batch_queued')).toBe(false);
    expect(() => nextState(job({ current_state: 'vton_batch_queued' }))).toThrow(/No transition defined/);
  });

  test('replaying the generating_vton edge is what resumes a parked job', () => {
    const parked = job({ current_state: 'vton_batch_queued', vton_lane: 'batch' });
    expect(nextState({ ...parked, current_state: 'generating_vton' })).toBe('segmenting');
  });
});
