import { buildOutfitEnrichmentPrompt, normalizeOutfitEnrichmentOutput } from '../../config/outfitEnrichmentPrompt';

describe('outfit enrichment prompt + normalization', () => {
  it('includes optional hints when provided', () => {
    const prompt = buildOutfitEnrichmentPrompt({
      genderInput: 'female',
      categoryInput: 'Streetwear',
      occasionInput: 'Travel',
      description: 'Black tee + denim, simple.',
    });

    expect(prompt).toContain('<context>');
    expect(prompt).toContain('User Gender: female');
    expect(prompt).toContain('User Preferred Category: Streetwear');
    expect(prompt).toContain('User Preferred Occasion: Travel');
    expect(prompt).toContain('Input Description: Black tee + denim, simple.');
  });

  it('normalizes missing or invalid fields to nulls', () => {
    const normalized = normalizeOutfitEnrichmentOutput({ not: 'a schema match' });
    expect(normalized).toEqual({
      outfit_name: null,
      ui_category: null,
      ui_occasion: null,
      analyzed_occasions: null,
      components_list: null,
      fit: null,
      feel: null,
      vibes: null,
      word_association: null,
      description_text: null,
      search_summary: null,
    });
  });

  it('normalizes string lists into arrays and trims tokens', () => {
    const normalized = normalizeOutfitEnrichmentOutput({
      outfit_name: 'Urban Minimalist Coffee Run',
      ui_category: 'Streetwear',
      ui_occasion: 'Travel',
      analyzed_occasions: ['Weekend Art Gallery', 'Casual Friday', 'Airport Travel'],
      components_list: ['Cream quarter-zip sweater', 'Light-wash wide-leg jeans', 'Black loafers'],
      fit: 'relaxed,  oversized ',
      feel: ['soft', ''],
      vibes: 'minimalist\nstreetwear',
      word_association: ['urban', 'clean'],
      description_text: 'Two-tone look.\nLine2.\nLine3.\nLine4.',
      search_summary: 'oatmeal quarter-zip with light wash denim, cozy city stroll outfit',
    });

    expect(normalized.outfit_name).toBe('Urban Minimalist Coffee Run');
    expect(normalized.ui_category).toBe('Streetwear');
    expect(normalized.ui_occasion).toBe('Travel');
    expect(normalized.analyzed_occasions).toEqual(['Weekend Art Gallery', 'Casual Friday', 'Airport Travel']);
    expect(normalized.components_list).toEqual(['Cream quarter-zip sweater', 'Light-wash wide-leg jeans', 'Black loafers']);
    expect(normalized.fit).toEqual(['relaxed', 'oversized']);
    expect(normalized.feel).toEqual(['soft']);
    expect(normalized.vibes).toEqual(['minimalist', 'streetwear']);
    expect(normalized.word_association).toEqual(['urban', 'clean']);
    expect(normalized.description_text).toBe('Two-tone look.\nLine2.\nLine3.\nLine4.');
    expect(normalized.search_summary).toBe('oatmeal quarter-zip with light wash denim, cozy city stroll outfit');
  });
});

