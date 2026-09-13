/**
 * The regression these encode: Myntra's anti-bot page arrives as HTTP 200 titled "Site
 * Maintenance", and the extraction step invented a product from it. Every assertion below uses the
 * shape actually observed on 2026-09-13.
 */
import { describe, expect, test } from 'bun:test';
import { blockedPageReason, isPlaceholderImageUrl } from './blocked-page';

describe('blocked-page — a 200 that is not a product page', () => {
  // The exact payload Firecrawl returned for a Myntra PDP on 2026-09-13.
  const MYNTRA_BLOCK = {
    title: 'Site Maintenance',
    body: '# Oops! Something went wrong\n\n* * *\n\nPlease contact your administrator',
    imageUrls: ['https://www.example.com/assets/images/32796823/detail.jpg'],
  };

  test('the observed Myntra block is caught', () => {
    expect(blockedPageReason(MYNTRA_BLOCK)).not.toBeNull();
  });

  test('it is caught on the title alone, before any image is extracted', () => {
    expect(blockedPageReason({ title: 'Site Maintenance' })).not.toBeNull();
  });

  test('it is caught on the body alone, for a block page we have no title for', () => {
    expect(blockedPageReason({ title: '', body: 'Oops! Something went wrong' })).not.toBeNull();
  });

  test('common WAF interstitials are caught', () => {
    for (const title of ['Just a moment...', 'Access Denied', 'Attention Required! | Cloudflare', 'Pardon Our Interruption']) {
      expect(blockedPageReason({ title })).not.toBeNull();
    }
  });

  // The whole point: a real PDP must not be mistaken for a block, or the guard fails live work.
  test('a real product page passes', () => {
    expect(blockedPageReason({
      title: 'Buy ZYNG Women Strapless Bodycon Mini Dress - Dresses for Women 32796823 | Myntra',
      body: '# ZYNG\n\n# Women Strapless Bodycon Mini Dress\n\n**₹735**',
      imageUrls: ['https://assets.myntassets.com/v1/assets/images/32796823/2024/1/1/photo.jpg'],
    })).toBeNull();
  });

  test('a sparse but genuine page is not a block — length is not a signal', () => {
    expect(blockedPageReason({ title: 'Plain Tee | Store', body: 'Tee. ₹499.', imageUrls: ['https://cdn.store.com/tee.jpg'] }))
      .toBeNull();
  });
});

describe('blocked-page — hallucinated image URLs', () => {
  test('the placeholder host the model actually emitted is recognised', () => {
    expect(isPlaceholderImageUrl('https://www.example.com/assets/images/32796823/detail.jpg')).toBe(true);
  });

  test('real product CDNs are not', () => {
    for (const url of [
      'https://assets.myntassets.com/v1/assets/images/32796823/2024/1/1/photo.jpg',
      'https://cdn.shopify.com/s/files/1/0/product.jpg',
    ]) {
      expect(isPlaceholderImageUrl(url)).toBe(false);
    }
  });

  test('all-placeholder extraction is a block even when the page looks innocent', () => {
    expect(blockedPageReason({ title: 'Product', body: 'x', imageUrls: ['https://example.com/a.jpg'] }))
      .not.toBeNull();
  });

  // Defensive: one real image means the page WAS read, so this is not a block.
  test('a mix keeps the page — one real image proves it was read', () => {
    expect(blockedPageReason({
      title: 'Product',
      body: 'x',
      imageUrls: ['https://example.com/a.jpg', 'https://assets.myntassets.com/v1/assets/images/1/a.jpg'],
    })).toBeNull();
  });

  test('garbage URLs do not throw', () => {
    expect(isPlaceholderImageUrl('not a url')).toBe(false);
  });
});
