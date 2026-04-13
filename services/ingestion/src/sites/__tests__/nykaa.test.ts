import { applyNykaaDeterministicImageFilter, nykaaProductIdFromUrl, isNykaaHostname } from '../nykaa';

describe('nykaa deterministic image filter', () => {
    describe('nykaaProductIdFromUrl', () => {
        it('extracts product ID from standard URL', () => {
            const url = 'https://www.nykaafashion.com/cider-faux-leather-solid-split-mini-skirt/p/17910578?adsource=shopping_india&skuId=17906178';
            expect(nykaaProductIdFromUrl(url)).toBe('17910578');
        });

        it('returns null for invalid URL', () => {
            expect(nykaaProductIdFromUrl('not-a-url')).toBe(null);
        });

        it('returns null for URL without product ID pattern', () => {
            expect(nykaaProductIdFromUrl('https://www.nykaafashion.com/category/dresses')).toBe(null);
        });
    });

    describe('isNykaaHostname', () => {
        it('recognizes nykaafashion.com', () => {
            expect(isNykaaHostname('nykaafashion.com')).toBe(true);
            expect(isNykaaHostname('www.nykaafashion.com')).toBe(true);
        });

        it('recognizes nykaa.com', () => {
            expect(isNykaaHostname('nykaa.com')).toBe(true);
            expect(isNykaaHostname('www.nykaa.com')).toBe(true);
        });

        it('recognizes nykaa subdomains', () => {
            expect(isNykaaHostname('adn-static1.nykaa.com')).toBe(true);
        });

        it('rejects non-nykaa hostnames', () => {
            expect(isNykaaHostname('amazon.com')).toBe(false);
            expect(isNykaaHostname('myntra.com')).toBe(false);
        });
    });

    describe('applyNykaaDeterministicImageFilter', () => {
        it('extracts images with data-at="pdp-product-image" attribute', () => {
            const originalUrl = 'https://www.nykaafashion.com/cider-faux-leather-solid-split-mini-skirt/p/17910578';
            const html = [
                '<div class="css-la88oxd" style="transform: translateY(0px);">',
                '  <div tabindex="0" class="css-snjjyz">',
                '    <img src="https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/1/7/17910578_Black_1.jpg?rnd=20200526195200&trw=128" ',
                '         class="pdp-selector-img css-qyfk59" width="80" height="106.666" alt="Cider - 1" ',
                '         srcset="https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/1/7/17910578_Black_1.jpg?rnd=20200526195200&trw=128 1x, ',
                '                 https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/1/7/17910578_Black_1.jpg?rnd=20200526195200&trw=256 2x, ',
                '                 https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/1/7/17910578_Black_1.jpg?rnd=20200526195200&trw=256 3x" ',
                '         loading="lazy" decoding="async" role="button" aria-label="Select Image" data-at="pdp-product-image">',
                '  </div>',
                '  <div tabindex="0" class="css-snjjyz">',
                '    <img src="https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/1/7/17910578_Black_2.jpg?rnd=20200526195200&trw=128" ',
                '         class="pdp-selector-img css-qyfk59" width="80" height="106.666" alt="Cider - 2" ',
                '         srcset="https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/1/7/17910578_Black_2.jpg?rnd=20200526195200&trw=128 1x, ',
                '                 https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/1/7/17910578_Black_2.jpg?rnd=20200526195200&trw=256 2x, ',
                '                 https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/1/7/17910578_Black_2.jpg?rnd=20200526195200&trw=256 3x" ',
                '         loading="lazy" decoding="async" role="button" aria-label="Select Image" data-at="pdp-product-image">',
                '  </div>',
                '</div>',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyNykaaDeterministicImageFilter({ originalUrl, json, html });

            expect(out.imageUrls.length).toBe(2);
            expect(out.imageUrls[0]).toContain('17910578_Black_1.jpg');
            expect(out.imageUrls[1]).toContain('17910578_Black_2.jpg');
            // Should pick highest resolution from srcset (256 trw)
            expect(out.imageUrls[0]).toContain('trw=256');
        });

        it('extracts images with pdp-selector-img class', () => {
            const originalUrl = 'https://www.nykaafashion.com/dress/p/12345678';
            const html = [
                '<div>',
                '  <img class="pdp-selector-img css-abc" ',
                '       src="https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/a.jpg?trw=128">',
                '</div>',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyNykaaDeterministicImageFilter({ originalUrl, json, html });

            expect(out.imageUrls.length).toBe(1);
            expect(out.imageUrls[0]).toContain('a.jpg');
        });

        it('uses JSON images as fallback when HTML has no gallery', () => {
            const originalUrl = 'https://www.nykaafashion.com/dress/p/12345678';
            const json = {
                images: [
                    { url: 'https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/x.jpg' },
                    { url: 'https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/y.jpg' }
                ]
            } as Record<string, unknown>;

            const out = applyNykaaDeterministicImageFilter({ originalUrl, json, html: undefined });

            expect(out.imageUrls.length).toBe(2);
        });

        it('excludes non-Nykaa CDN URLs', () => {
            const originalUrl = 'https://www.nykaafashion.com/dress/p/12345678';
            const html = [
                '<img class="pdp-selector-img" src="https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/valid.jpg">',
                '<img class="pdp-selector-img" src="https://some-other-cdn.com/random.jpg">',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyNykaaDeterministicImageFilter({ originalUrl, json, html });

            expect(out.imageUrls.length).toBe(1);
            expect(out.imageUrls[0]).toContain('valid.jpg');
        });

        it('outputs images array with metadata in json', () => {
            const originalUrl = 'https://www.nykaafashion.com/dress/p/12345678';
            const html = [
                '<img class="pdp-selector-img" src="https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/a.jpg">',
                '<img class="pdp-selector-img" src="https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/product/b.jpg">',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyNykaaDeterministicImageFilter({ originalUrl, json, html });

            const images = out.json['images'] as Array<{ url: string; sort_order_suggestion: number; is_primary_suggestion: boolean }>;
            expect(images).toHaveLength(2);
            expect(images[0].is_primary_suggestion).toBe(true);
            expect(images[0].sort_order_suggestion).toBe(0);
            expect(images[1].is_primary_suggestion).toBe(false);
            expect(images[1].sort_order_suggestion).toBe(1);
        });
    });
});
