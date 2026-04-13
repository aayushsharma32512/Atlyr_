import { applyPumaDeterministicImageFilter, pumaProductIdFromUrl, isPumaHostname } from '../puma';

describe('puma deterministic image filter', () => {
    describe('pumaProductIdFromUrl', () => {
        it('extracts product ID from standard URL', () => {
            const url = 'https://in.puma.com/in/en/pd/blktop-rider-suede-sneakers/392725?swatch=07';
            expect(pumaProductIdFromUrl(url)).toBe('392725');
        });

        it('extracts product ID from URL without query params', () => {
            const url = 'https://in.puma.com/in/en/pd/rs-x-sneakers/391928';
            expect(pumaProductIdFromUrl(url)).toBe('391928');
        });

        it('returns null for invalid URL', () => {
            expect(pumaProductIdFromUrl('not-a-url')).toBe(null);
        });

        it('returns null for URL without product ID', () => {
            expect(pumaProductIdFromUrl('https://in.puma.com/in/en/men')).toBe(null);
        });
    });

    describe('isPumaHostname', () => {
        it('recognizes puma.com', () => {
            expect(isPumaHostname('puma.com')).toBe(true);
            expect(isPumaHostname('www.puma.com')).toBe(true);
        });

        it('recognizes regional subdomains', () => {
            expect(isPumaHostname('in.puma.com')).toBe(true);
            expect(isPumaHostname('eu.puma.com')).toBe(true);
            expect(isPumaHostname('us.puma.com')).toBe(true);
        });

        it('rejects non-puma hostnames', () => {
            expect(isPumaHostname('nike.com')).toBe(false);
            expect(isPumaHostname('myntra.com')).toBe(false);
            expect(isPumaHostname('fakepuma.com')).toBe(false);
        });
    });

    describe('applyPumaDeterministicImageFilter', () => {
        it('extracts high-res images from Puma CDN', () => {
            const originalUrl = 'https://in.puma.com/in/en/pd/sneakers/392725';
            const html = [
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_600,h_600/global/392725/07/image1.png" alt="Product">',
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_600,h_600/global/392725/07/image2.png" alt="Product">',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyPumaDeterministicImageFilter({ originalUrl, json, html });

            expect(out.imageUrls.length).toBe(2);
            expect(out.imageUrls[0]).toContain('w_2000,h_2000');
            expect(out.imageUrls[1]).toContain('w_2000,h_2000');
        });

        it('excludes style picker thumbnails (w_100)', () => {
            const originalUrl = 'https://in.puma.com/in/en/pd/sneakers/392725';
            const html = [
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_100,h_100/global/392725/07/swatch.png">',
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_600,h_600/global/392725/07/main.png">',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyPumaDeterministicImageFilter({ originalUrl, json, html });

            expect(out.imageUrls.length).toBe(1);
            expect(out.imageUrls[0]).toContain('main.png');
        });

        it('excludes video URLs', () => {
            const originalUrl = 'https://in.puma.com/in/en/pd/sneakers/392725';
            const html = [
                '<img src="https://images.puma.com/video/upload/f_auto/global/392725/video.mp4">',
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_600,h_600/global/392725/07/product.png">',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyPumaDeterministicImageFilter({ originalUrl, json, html });

            expect(out.imageUrls.length).toBe(1);
            expect(out.imageUrls[0]).toContain('product.png');
        });

        it('upgrades resolution to w_2000,h_2000', () => {
            const originalUrl = 'https://in.puma.com/in/en/pd/sneakers/392725';
            const html = [
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_600,h_600/global/392725/07/product.png">',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyPumaDeterministicImageFilter({ originalUrl, json, html });

            expect(out.imageUrls.length).toBe(1);
            expect(out.imageUrls[0]).toContain('w_2000,h_2000');
            expect(out.imageUrls[0]).not.toContain('w_600');
        });

        it('outputs images array with metadata in json', () => {
            const originalUrl = 'https://in.puma.com/in/en/pd/sneakers/392725';
            const html = [
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_600,h_600/global/392725/07/a.png">',
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_600,h_600/global/392725/07/b.png">',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyPumaDeterministicImageFilter({ originalUrl, json, html });

            const images = out.json['images'] as Array<{ url: string; sort_order_suggestion: number; is_primary_suggestion: boolean }>;
            expect(images).toHaveLength(2);
            expect(images[0].is_primary_suggestion).toBe(true);
            expect(images[0].sort_order_suggestion).toBe(0);
            expect(images[1].is_primary_suggestion).toBe(false);
            expect(images[1].sort_order_suggestion).toBe(1);
        });

        it('deduplicates images by asset key', () => {
            const originalUrl = 'https://in.puma.com/in/en/pd/sneakers/392725';
            const html = [
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_600,h_600/global/392725/07/same.png">',
                '<img src="https://images.puma.com/image/upload/f_auto,q_auto,w_800,h_800/global/392725/07/same.png">',
            ].join('\n');

            const json = {} as Record<string, unknown>;
            const out = applyPumaDeterministicImageFilter({ originalUrl, json, html });

            // Should deduplicate and keep highest resolution version
            expect(out.imageUrls.length).toBe(1);
        });
    });
});
