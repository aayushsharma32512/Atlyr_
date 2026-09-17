import { splitTagList, dedupeTags, getProductTags, getTrayItemTags, getOutfitTagsFromItems } from './productTags';

describe('productTags', () => {
  describe('splitTagList', () => {
    it('splits a comma list and trims entries', () => {
      expect(splitTagList('Slim, Casual , Cropped')).toEqual(['Slim', 'Casual', 'Cropped']);
    });

    it('drops empty, null and nan entries', () => {
      expect(splitTagList('Slim,,null,NaN, Casual')).toEqual(['Slim', 'Casual']);
    });

    it('returns an empty array for null/undefined/empty input', () => {
      expect(splitTagList(null)).toEqual([]);
      expect(splitTagList(undefined)).toEqual([]);
      expect(splitTagList('')).toEqual([]);
    });
  });

  describe('dedupeTags', () => {
    it('dedupes case-insensitively, keeping first-seen casing and order', () => {
      expect(dedupeTags(['Slim', 'casual', 'SLIM', 'Cropped', 'Casual'])).toEqual(['Slim', 'casual', 'Cropped']);
    });

    it('trims and drops empty entries', () => {
      expect(dedupeTags([' Slim ', '', '  ', 'Casual'])).toEqual(['Slim', 'Casual']);
    });
  });

  describe('getProductTags', () => {
    it('orders fit, feel, vibes, color_group, material_type and dedupes', () => {
      const tags = getProductTags({
        fit: 'Slim, Relaxed',
        feel: 'Soft',
        vibes: 'Casual, Slim',
        color_group: 'Black',
        material_type: 'Cotton',
      });
      expect(tags).toEqual(['Slim', 'Relaxed', 'Soft', 'Casual', 'Black', 'Cotton']);
    });

    it('handles nulls for every field', () => {
      expect(getProductTags({ fit: null, feel: null, vibes: null, color_group: null, material_type: null })).toEqual([]);
    });

    it('returns an empty array for a null/undefined product', () => {
      expect(getProductTags(null)).toEqual([]);
      expect(getProductTags(undefined)).toEqual([]);
    });
  });

  describe('getTrayItemTags', () => {
    it('orders fitTags, feelTags, vibeTags, colorGroup, materialType and dedupes', () => {
      const tags = getTrayItemTags({
        fitTags: ['Slim'],
        feelTags: ['Soft'],
        vibeTags: ['Casual'],
        colorGroup: 'Black',
        materialType: 'slim',
      });
      // "slim" (materialType) is a case-insensitive dupe of "Slim" (fitTags) and is dropped.
      expect(tags).toEqual(['Slim', 'Soft', 'Casual', 'Black']);
    });

    it('returns an empty array for a null/undefined item', () => {
      expect(getTrayItemTags(null)).toEqual([]);
      expect(getTrayItemTags(undefined)).toEqual([]);
    });
  });

  describe('getOutfitTagsFromItems', () => {
    it('concatenates each item\'s tags in item order and dedupes across items', () => {
      const tags = getOutfitTagsFromItems([
        { fit: 'Slim', feel: null, vibes: 'Casual', color_group: null, material_type: null },
        { fit: 'Relaxed', feel: 'Soft', vibes: 'Casual', color_group: 'Black', material_type: null },
      ]);
      expect(tags).toEqual(['Slim', 'Casual', 'Relaxed', 'Soft', 'Black']);
    });

    it('accepts tray items (fitTags arrays) as well as raw product-shaped items', () => {
      const tags = getOutfitTagsFromItems([
        { fitTags: ['Slim'], feelTags: [], vibeTags: ['Casual'], colorGroup: null, materialType: null },
        { fit: 'Relaxed', feel: null, vibes: null, color_group: null, material_type: 'Cotton' },
      ]);
      expect(tags).toEqual(['Slim', 'Casual', 'Relaxed', 'Cotton']);
    });

    it('returns an empty array for no items', () => {
      expect(getOutfitTagsFromItems([])).toEqual([]);
    });
  });
});
