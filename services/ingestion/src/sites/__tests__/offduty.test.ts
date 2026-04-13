import { applyOffdutyDeterministicImageFilter } from '../offduty';

describe('offduty deterministic image filter', () => {
  it('extracts gallery images from product__thumb-item and prefers highest resolution', () => {
    const originalUrl = 'https://offduty.in/products/aesthetic-high-waisted-wide-fit-baggy-jeans';
    const rawHtml = [
      '<div class="product__thumbs-scroll">',
      '  <div class="product__thumb-item" data-index="0">',
      '    <div class="image-wrap">',
      '      <a href="//offduty.in/cdn/shop/files/p_01_1800x1800.jpg?v=1">',
      '        <img data-srcset="//offduty.in/cdn/shop/files/p_01_100x.jpg?v=1 100w, //offduty.in/cdn/shop/files/p_01_540x.jpg?v=1 540w" />',
      '      </a>',
      '    </div>',
      '  </div>',
      '  <div class="product__thumb-item" data-index="1">',
      '    <div class="image-wrap">',
      '      <a href="#">',
      '        <img data-srcset="//offduty.in/cdn/shop/files/p_02_100x.jpg?v=1 100w, //offduty.in/cdn/shop/files/p_02_1800x1800.jpg?v=1 1800w" />',
      '      </a>',
      '    </div>',
      '  </div>',
      '  <div class="product__thumb-item" data-index="2">',
      '    <div class="image-wrap">',
      '      <a href="//offduty.in/cdn/shop/videos/c/vp/x.mp4?v=0">Video</a>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="payment-icons"><img src="https://offduty.in/cdn/shop/files/visa_300x.svg?v=1" /></div>',
    ].join('\n');

    const json = {
      images: [
        { url: 'https://offduty.in/cdn/shop/files/p_02_360x.jpg?v=1' },
        { url: 'https://offduty.in/cdn/shop/videos/c/vp/y.mp4?v=0' },
      ]
    } as Record<string, unknown>;

    const out = applyOffdutyDeterministicImageFilter({ originalUrl, json, rawHtml });
    expect(out.imageUrls).toEqual([
      'https://offduty.in/cdn/shop/files/p_01_1800x1800.jpg?v=1',
      'https://offduty.in/cdn/shop/files/p_02_1800x1800.jpg?v=1',
    ]);

    const images = (out.json['images'] as Array<Record<string, unknown>>);
    expect(images.length).toBe(2);
    expect(images[0]?.['is_primary_suggestion']).toBe(true);
    expect(images[0]?.['sort_order_suggestion']).toBe(0);
    expect(images[1]?.['sort_order_suggestion']).toBe(1);
  });
});

