import { test, expect } from 'bun:test';
import { resolveVtonModel } from './index';
import type { IngestionPipelineJob } from '../../domain/types';

function job(overrides: Partial<IngestionPipelineJob>): IngestionPipelineJob {
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
    current_state: 'generating_vton',
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

test('resolveVtonModel routes to fashn_vton when explicitly requested', () => {
  const provider = resolveVtonModel(job({ v_ton_model: 'fashn_vton', product_complexity: 'complex' }));
  expect(provider.name).toBe('fashn_vton');
});

test('resolveVtonModel defaults to gemini_nano_banana regardless of product_complexity', () => {
  expect(resolveVtonModel(job({ v_ton_model: null, product_complexity: 'simple' })).name).toBe('gemini_nano_banana');
  expect(resolveVtonModel(job({ v_ton_model: null, product_complexity: 'complex' })).name).toBe('gemini_nano_banana');
});

test('resolveVtonModel routes to gemini_nano_banana when explicitly requested', () => {
  const provider = resolveVtonModel(job({ v_ton_model: 'gemini_nano_banana' }));
  expect(provider.name).toBe('gemini_nano_banana');
});

test('resolveVtonModel throws for an unregistered manual override', () => {
  expect(() => resolveVtonModel(job({ v_ton_model: 'seedream' }))).toThrow('E_UNKNOWN_VTON_MODEL');
});
