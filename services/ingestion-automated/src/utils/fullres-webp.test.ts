import { test, expect } from 'bun:test';
import { fullresSiblingPath, ensureFullresWebp, FULLRES_SUFFIX } from './fullres-webp';

test('fullresSiblingPath replaces the trailing extension', () => {
  expect(fullresSiblingPath('job1/segmentation/final.png')).toBe('job1/segmentation/final.fullres.webp');
  expect(fullresSiblingPath('a/b/c.jpg')).toBe('a/b/c.fullres.webp');
  expect(fullresSiblingPath('a/b/c.JPEG')).toBe('a/b/c.fullres.webp');
});

test('fullresSiblingPath leaves an already-converted path alone', () => {
  const p = 'job1/segmentation/final.fullres.webp';
  expect(fullresSiblingPath(p)).toBe(p);
});

test('fullresSiblingPath appends when there is no extension', () => {
  expect(fullresSiblingPath('job1/segmentation/final')).toBe(`job1/segmentation/final${FULLRES_SUFFIX}`);
});

test('fullresSiblingPath does not mistake a dotted directory for an extension', () => {
  expect(fullresSiblingPath('v1.2/final.png')).toBe('v1.2/final.fullres.webp');
});

// These two short-circuit before any network call, so they are safe to assert directly.
test('ensureFullresWebp returns an already-converted URL unchanged', async () => {
  const url = 'https://x.supabase.co/storage/v1/object/public/b/job1/segmentation/final.fullres.webp';
  expect(await ensureFullresWebp(url)).toBe(url);
});

test('ensureFullresWebp returns null for a blank or non-storage URL', async () => {
  expect(await ensureFullresWebp(null)).toBeNull();
  expect(await ensureFullresWebp('')).toBeNull();
  expect(await ensureFullresWebp('https://cdn.example.com/some/image.png')).toBeNull();
});
