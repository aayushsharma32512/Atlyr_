import { selectSiteProfile } from '../registry';

describe('site registry', () => {
  it('selects myntra profile and captures styleId', () => {
    const url = 'https://www.myntra.com/shirts/brand/12345/buy';
    const { profile, ctx } = selectSiteProfile(url);
    expect(profile.id).toBe('myntra');
    expect(ctx.normalizedHostname).toBe('myntra.com');
    expect(ctx.styleId).toBe('12345');
  });

  it('composes myntra prompt with override fragment', () => {
    const url = 'https://myntra.com/shirts/brand/12345/buy';
    const { profile, ctx } = selectSiteProfile(url);
    const prompt = profile.buildScrapePrompt({ originalUrl: url, basePrompt: 'BASE_PROMPT', ctx });
    expect(prompt).toContain('BASE_PROMPT');
    expect(prompt).toContain('MYNTRA OVERRIDE');
    expect(prompt).toContain('Myntra style_id for THIS PDP: 12345');
  });

  it('falls back to default profile for other hosts', () => {
    const url = 'https://example.com/product/abc';
    const { profile, ctx } = selectSiteProfile(url);
    expect(profile.id).toBe('default');
    expect(ctx.styleId).toBeUndefined();
  });

  it('selects offduty profile', () => {
    const url = 'https://offduty.in/products/black-plazo-fall-wide-leg-high-rise-jeans';
    const { profile } = selectSiteProfile(url);
    expect(profile.id).toBe('offduty');
  });

  it('selects mango profile', () => {
    const url = 'https://shop.mango.com/in/en/p/women/overalls/short/halter-neck-jumpsuit_17084144';
    const { profile } = selectSiteProfile(url);
    expect(profile.id).toBe('mango');
  });

  it('selects nykaa profile and captures productId', () => {
    const url = 'https://www.nykaafashion.com/cider-faux-leather-solid-split-mini-skirt/p/17910578?adsource=shopping_india&skuId=17906178';
    const { profile, ctx } = selectSiteProfile(url);
    expect(profile.id).toBe('nykaa');
    expect(ctx.normalizedHostname).toBe('nykaafashion.com');
    expect(ctx.productId).toBe('17910578');
  });

  it('composes nykaa prompt with override fragment', () => {
    const url = 'https://nykaafashion.com/dress/p/12345678';
    const { profile, ctx } = selectSiteProfile(url);
    const prompt = profile.buildScrapePrompt({ originalUrl: url, basePrompt: 'BASE_PROMPT', ctx });
    expect(prompt).toContain('BASE_PROMPT');
    expect(prompt).toContain('NYKAA FASHION OVERRIDE');
    expect(prompt).toContain('Nykaa Fashion product_id for THIS PDP: 12345678');
  });

  it('selects puma profile and captures productId', () => {
    const url = 'https://in.puma.com/in/en/pd/blktop-rider-suede-sneakers/392725?swatch=07';
    const { profile, ctx } = selectSiteProfile(url);
    expect(profile.id).toBe('puma');
    expect(ctx.normalizedHostname).toBe('in.puma.com');
    expect(ctx.productId).toBe('392725');
  });

  it('composes puma prompt with override fragment', () => {
    const url = 'https://in.puma.com/in/en/pd/rs-x-sneakers/391928';
    const { profile, ctx } = selectSiteProfile(url);
    const prompt = profile.buildScrapePrompt({ originalUrl: url, basePrompt: 'BASE_PROMPT', ctx });
    expect(prompt).toContain('BASE_PROMPT');
    expect(prompt).toContain('PUMA OVERRIDE');
    expect(prompt).toContain('Puma product_id for THIS PDP: 391928');
  });
});
