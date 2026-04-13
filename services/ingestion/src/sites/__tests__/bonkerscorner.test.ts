import { applyBonkersCornerDeterministicImageFilter, isBonkersCornerHostname } from '../bonkerscorner';

describe('bonkerscorner hostname detection', () => {
  it('matches bonkerscorner.com', () => {
    expect(isBonkersCornerHostname('bonkerscorner.com')).toBe(true);
    expect(isBonkersCornerHostname('www.bonkerscorner.com')).toBe(true);
  });

  it('does not match other domains', () => {
    expect(isBonkersCornerHostname('offduty.in')).toBe(false);
    expect(isBonkersCornerHostname('bonkerscorner.in')).toBe(false);
  });
});

describe('bonkerscorner deterministic image filter', () => {
  it('extracts gallery images from product-images__slide elements', () => {
    const originalUrl = 'https://www.bonkerscorner.com/products/black-parachute-pants';
    const rawHtml = [
      '<div class="header"><img src="https://www.bonkerscorner.com/cdn/shop/files/logo.svg" /></div>',
      '<div class="product-images product-images--collage">',
      '  <div class="product-images__slide product-images__slide--image">',
      '    <img class="no-blur lazyautosizes" src="https://www.bonkerscorner.com/cdn/shop/files/black-parachute-pants-1_960x.jpg?v=1" />',
      '  </div>',
      '  <div class="product-images__slide product-images__slide--image">',
      '    <img class="no-blur lazyautosizes" src="https://www.bonkerscorner.com/cdn/shop/files/black-parachute-pants-2_960x.jpg?v=1" />',
      '  </div>',
      '</div>',
      '<div class="product-option color-swatch">',
      '  <img src="https://www.bonkerscorner.com/cdn/shop/files/green-swatch.jpg?v=1" />',
      '</div>',
    ].join('\n');

    const json = { images: [] } as Record<string, unknown>;
    const out = applyBonkersCornerDeterministicImageFilter({ originalUrl, json, rawHtml });

    // Should only have the 2 gallery images, not color swatches
    expect(out.imageUrls).toEqual([
      'https://www.bonkerscorner.com/cdn/shop/files/black-parachute-pants-1_960x.jpg?v=1',
      'https://www.bonkerscorner.com/cdn/shop/files/black-parachute-pants-2_960x.jpg?v=1',
    ]);
  });

  it('excludes video files within slides', () => {
    const originalUrl = 'https://www.bonkerscorner.com/products/test';
    const rawHtml = [
      '<div class="product-images--collage">',
      '  <div class="product-images__slide">',
      '    <img src="https://www.bonkerscorner.com/cdn/shop/files/product_960x.jpg?v=1" />',
      '  </div>',
      '  <div class="product-images__slide">',
      '    <video src="https://www.bonkerscorner.com/cdn/shop/videos/demo.mp4" />',
      '  </div>',
      '</div>',
    ].join('\n');

    const json = { images: [] } as Record<string, unknown>;
    const out = applyBonkersCornerDeterministicImageFilter({ originalUrl, json, rawHtml });

    expect(out.imageUrls).toEqual([
      'https://www.bonkerscorner.com/cdn/shop/files/product_960x.jpg?v=1',
    ]);
  });

  it('deduplicates images by base asset key, preferring highest resolution', () => {
    const originalUrl = 'https://www.bonkerscorner.com/products/test';
    const rawHtml = [
      '<div class="product-images--collage">',
      '  <div class="product-images__slide">',
      '    <img src="https://www.bonkerscorner.com/cdn/shop/files/product_100x100.jpg?v=1"',
      '         data-srcset="https://www.bonkerscorner.com/cdn/shop/files/product_1800x1800.jpg?v=1 1800w" />',
      '  </div>',
      '</div>',
    ].join('\n');

    const json = { images: [] } as Record<string, unknown>;
    const out = applyBonkersCornerDeterministicImageFilter({ originalUrl, json, rawHtml });

    // Should only have the higher resolution version
    expect(out.imageUrls).toEqual([
      'https://www.bonkerscorner.com/cdn/shop/files/product_1800x1800.jpg?v=1',
    ]);
  });

  it('sets primary image correctly', () => {
    const originalUrl = 'https://www.bonkerscorner.com/products/test';
    const rawHtml = [
      '<div class="product-images--collage">',
      '  <div class="product-images__slide">',
      '    <img src="https://www.bonkerscorner.com/cdn/shop/files/a_960x.jpg?v=1" />',
      '  </div>',
      '  <div class="product-images__slide">',
      '    <img src="https://www.bonkerscorner.com/cdn/shop/files/b_960x.jpg?v=1" />',
      '  </div>',
      '</div>',
    ].join('\n');

    const json = { images: [] } as Record<string, unknown>;
    const out = applyBonkersCornerDeterministicImageFilter({ originalUrl, json, rawHtml });

    const images = out.json['images'] as Array<Record<string, unknown>>;
    expect(images[0]?.['is_primary_suggestion']).toBe(true);
    expect(images[0]?.['sort_order_suggestion']).toBe(0);
    expect(images[1]?.['is_primary_suggestion']).toBe(false);
    expect(images[1]?.['sort_order_suggestion']).toBe(1);
  });

  it('handles protocol-relative URLs from srcset', () => {
    const originalUrl = 'https://www.bonkerscorner.com/products/test';
    const rawHtml = [
      '<div class="product-images--collage">',
      '  <div class="product-images__slide">',
      '    <img src="//www.bonkerscorner.com/cdn/shop/files/Bonkerscorner_Pants_960x.jpg?v=1"',
      '         data-srcset="//www.bonkerscorner.com/cdn/shop/files/Bonkerscorner_Pants_375x_crop_center.jpg?v=1 375w, //www.bonkerscorner.com/cdn/shop/files/Bonkerscorner_Pants_640x_crop_center.jpg?v=1 640w" />',
      '  </div>',
      '</div>',
    ].join('\n');

    const json = { images: [] } as Record<string, unknown>;
    const out = applyBonkersCornerDeterministicImageFilter({ originalUrl, json, rawHtml });

    // Should capture the highest resolution - the src URL without _crop_center suffix
    expect(out.imageUrls).toContain('https://www.bonkerscorner.com/cdn/shop/files/Bonkerscorner_Pants_960x.jpg?v=1');
  });
});
