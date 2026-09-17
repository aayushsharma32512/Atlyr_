import type { OutfitItem } from '@/types';
import { getOutfitChips } from './outfitChips';

function outfitItem(overrides: Partial<OutfitItem>): OutfitItem {
  return {
    id: 'item-1',
    type: 'top',
    brand: 'Brand',
    size: 'M',
    price: 100,
    currency: 'INR',
    imageUrl: 'https://example.com/image.jpg',
    description: 'desc',
    color: 'black',
    ...overrides,
  };
}

describe('outfitChips', () => {
  describe('getOutfitChips', () => {
    it('returns stored tags when non-empty, ignoring items and fit/feel/vibes', () => {
      const chips = getOutfitChips({
        fit: 'Slim',
        feel: 'Soft',
        vibes: 'Casual',
        tags: ['Date night', 'Weekend'],
        items: [outfitItem({ fit: 'Relaxed', feel: null, vibes: null, color_group: null, material_type: null })],
      });
      expect(chips).toEqual(['Date night', 'Weekend']);
    });

    it('derives tags from items when tags is empty or null', () => {
      const chips = getOutfitChips({
        fit: 'Slim',
        feel: 'Soft',
        vibes: 'Casual',
        tags: [],
        items: [
          outfitItem({ fit: 'Relaxed', feel: 'Soft', vibes: 'Casual', color_group: 'Black', material_type: null }),
        ],
      });
      expect(chips).toEqual(['Relaxed', 'Soft', 'Casual', 'Black']);
    });

    it('falls back to fit+feel+vibes split only when the outfit has no items', () => {
      const chips = getOutfitChips({
        fit: 'Slim, Relaxed',
        feel: 'Soft',
        vibes: 'Casual',
        tags: null,
        items: [],
      });
      expect(chips).toEqual(['Slim', 'Relaxed', 'Soft', 'Casual']);
    });

    it('returns an empty array for a null/undefined outfit', () => {
      expect(getOutfitChips(null)).toEqual([]);
      expect(getOutfitChips(undefined)).toEqual([]);
    });
  });
});
