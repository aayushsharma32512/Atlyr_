import { applyDefaultImageFilter } from '../default';

describe('default image filter', () => {
  it('filters out SVGs, GIFs, and payment/tracking patterns', () => {
    const originalUrl = 'https://example.com/product/123';
    const finalUrl = originalUrl;
    const json = { images: [] };
    const metadata = {};
    const imageUrls = [
      'https://example.com/product-front.jpg',
      'https://example.com/logo.svg',
      'https://example.com/spinner.gif',
      'https://example.com/visa-card.png',
      'https://google-analytics.com/collect?v=1',
      'https://example.com/product-back.webp',
    ];

    const out = applyDefaultImageFilter({
      originalUrl,
      finalUrl,
      json,
      metadata,
      imageUrls,
      html: undefined,
      rawHtml: undefined,
    });

    expect(out.imageUrls).toContain('https://example.com/product-front.jpg');
    expect(out.imageUrls).toContain('https://example.com/product-back.webp');
    expect(out.imageUrls).not.toContain('https://example.com/logo.svg');
    expect(out.imageUrls).not.toContain('https://example.com/spinner.gif');
    expect(out.imageUrls).not.toContain('https://example.com/visa-card.png');
    expect(out.imageUrls).not.toContain('https://google-analytics.com/collect?v=1');
  });

  it('extracts trusted images from JSON-LD and matches them against json images', () => {
    const originalUrl = 'https://example.com/product/123';
    const finalUrl = originalUrl;
    const json = { images: [] };
    const metadata = {};
    const imageUrls = [
      'https://cdn.example.com/files/product-front_large.jpg',
      'https://cdn.example.com/files/product-back_large.jpg',
      'https://cdn.example.com/files/recommend-product-1.jpg', // Unrelated recommended image
      'https://otherdomain.com/ad.jpg',
    ];

    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Super Shirt",
              "image": [
                "https://cdn.example.com/files/product-front.jpg",
                "https://cdn.example.com/files/product-back.jpg"
              ]
            }
          </script>
        </head>
      </html>
    `;

    const out = applyDefaultImageFilter({
      originalUrl,
      finalUrl,
      json,
      metadata,
      imageUrls,
      html,
      rawHtml: undefined,
    });

    // Should match by base key (filename) and exclude the recommended/ad images
    expect(out.imageUrls).toContain('https://cdn.example.com/files/product-front_large.jpg');
    expect(out.imageUrls).toContain('https://cdn.example.com/files/product-back_large.jpg');
    expect(out.imageUrls).not.toContain('https://cdn.example.com/files/recommend-product-1.jpg');
    expect(out.imageUrls).not.toContain('https://otherdomain.com/ad.jpg');
  });

  it('extracts trusted images from OG tags', () => {
    const originalUrl = 'https://example.com/product/123';
    const finalUrl = originalUrl;
    const json = { images: [] };
    const metadata = {};
    const imageUrls = [
      'https://cdn.example.com/files/product-hero.jpg',
      'https://cdn.example.com/files/recommend-product-2.jpg',
    ];

    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/files/product-hero.jpg" />
        </head>
      </html>
    `;

    const out = applyDefaultImageFilter({
      originalUrl,
      finalUrl,
      json,
      metadata,
      imageUrls,
      html,
      rawHtml: undefined,
    });

    expect(out.imageUrls).toContain('https://cdn.example.com/files/product-hero.jpg');
    expect(out.imageUrls).not.toContain('https://cdn.example.com/files/recommend-product-2.jpg');
  });

  it('extracts images from gallery containers and excludes recommendations', () => {
    const originalUrl = 'https://example.com/product/123';
    const finalUrl = originalUrl;
    const json = { images: [] };
    const metadata = {};
    const imageUrls = [
      'https://example.com/media/main-front.jpg',
      'https://example.com/media/main-back.jpg',
      'https://example.com/media/recommend-item.jpg',
    ];

    const html = `
      <div id="product-gallery">
        <img src="/media/main-front.jpg" />
        <img src="/media/main-back.jpg" />
      </div>
      <div class="recommendations">
        <img src="/media/recommend-item.jpg" />
      </div>
    `;

    const out = applyDefaultImageFilter({
      originalUrl,
      finalUrl,
      json,
      metadata,
      imageUrls,
      html,
      rawHtml: undefined,
    });

    expect(out.imageUrls).toContain('https://example.com/media/main-front.jpg');
    expect(out.imageUrls).toContain('https://example.com/media/main-back.jpg');
    expect(out.imageUrls).not.toContain('https://example.com/media/recommend-item.jpg');
  });
});
