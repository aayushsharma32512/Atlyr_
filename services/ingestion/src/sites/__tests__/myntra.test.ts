import { applyMyntraDeterministicImageFilter } from '../myntra';

describe('myntra deterministic image filter', () => {
  it('drops mismatched style_id images when id is explicit in URL', () => {
    const originalUrl = 'https://www.myntra.com/shirts/brand/12345/buy';
    const html = [
      '<div class="image-grid-container">',
      '  <div class="image-grid-image" style="background-image: url(&quot;https://assets.myntassets.com/h_720,q_90,w_540/v1/assets/images/12345/a.jpg&quot;);"></div>',
      '  <div class="image-grid-image" style="background-image: url(&quot;https://assets.myntassets.com/h_720,q_90,w_540/v1/assets/images/99999/b.jpg&quot;);"></div>',
      '</div>',
      '<div class="pdp-description-container"></div>',
    ].join('\n');

    const json = {
      images: [
        { url: 'https://assets.myntassets.com/h_720,q_90,w_540/v1/assets/images/12345/c.jpg' },
        { url: 'https://assets.myntassets.com/h_720,q_90,w_540/v1/assets/images/99999/d.jpg' }
      ]
    } as Record<string, unknown>;

    const out = applyMyntraDeterministicImageFilter({ originalUrl, json, html });
    expect(out.imageUrls.length).toBeGreaterThan(0);
    expect(out.imageUrls.every((u) => !u.includes('/assets/images/99999/'))).toBe(true);
    expect(out.imageUrls.some((u) => u.includes('/assets/images/12345/'))).toBe(true);
  });

  it('keeps date-based /assets/images/YYYY/... gallery URLs even when style_id is known', () => {
    const originalUrl = 'https://www.myntra.com/co-ords/griffel/anything/35700035/buy';
    const html = [
      '<div class="image-grid-container">',
      '  <div class="image-grid-image" style="background-image: url(&quot;https://assets.myntassets.com/h_720,q_90,w_540/v1/assets/images/2025/JULY/14/a.jpg&quot;);"></div>',
      '  <div class="image-grid-image" style="background-image: url(&quot;https://assets.myntassets.com/h_720,q_90,w_540/v1/assets/images/2025/JULY/14/b.jpg&quot;);"></div>',
      '</div>',
      '<div class="pdp-description-container"></div>',
    ].join('\n');

    const json = {
      images: [
        { url: 'https://assets.myntassets.com/assets/images/35700035/large.jpg' },
        { url: 'https://assets.myntassets.com/assets/images/35700035/side.jpg' },
      ]
    } as Record<string, unknown>;

    const out = applyMyntraDeterministicImageFilter({ originalUrl, json, html });
    expect(out.imageUrls.some((u) => u.includes('/v1/assets/images/2025/JULY/14/'))).toBe(true);
    expect(out.imageUrls.some((u) => /\\/assets\\/images\\/35700035\\/(large|side)\\.jpg$/i.test(u))).toBe(false);
  });

  it('does not force rewrite JSON image URLs into /v1 transform paths', () => {
    const originalUrl = 'https://www.myntra.com/tshirts/brand/33050058/buy';
    const json = {
      images: [
        { url: 'https://assets.myntassets.com/assets/images/33050058/0/a.jpg' },
      ]
    } as Record<string, unknown>;

    const out = applyMyntraDeterministicImageFilter({ originalUrl, json, html: undefined });
    expect(out.imageUrls[0]).toBe('https://assets.myntassets.com/assets/images/33050058/0/a.jpg');
  });
});
