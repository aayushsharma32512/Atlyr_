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
