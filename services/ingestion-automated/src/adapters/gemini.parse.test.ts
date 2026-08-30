import { test, expect, describe } from 'bun:test';
import { parseStage1 } from './gemini';

// NOTE: importing ./gemini pulls in config, which validates env at import time — run this
// from services/ingestion-automated so .env loads (see CLAUDE.md).

const FOOTWEAR_RESPONSE = `[TECH_PACK]
Material_Finish: Matte synthetic leather upper.
Sole_Construction: Flat molded sole with stitched welt.
Toe_Box_Shape: Open toe, rounded profile.

ITEM_NAME: dmodot Women Embellished Leather Slip-On Flip-Flops

[SHOE_PHYSICS]
Viewed from a front-facing standing angle, both shoes present a symmetrical low-profile slide silhouette with a rigid leather vamp strap.`;

const TOPWEAR_RESPONSE = `[TECH_PACK]
Material_Physics: Midweight cotton jersey.

ITEM_NAME: Brand Tee

[GARMENT_PHYSICS]
A direct front view of a matte midweight cotton tee.`;

describe('parseStage1', () => {
  test('captures [SHOE_PHYSICS] for footwear responses', () => {
    const parsed = parseStage1(FOOTWEAR_RESPONSE);
    expect(parsed.shoe_physics).toStartWith('[SHOE_PHYSICS]\n');
    expect(parsed.shoe_physics).toContain('front-facing standing angle');
    expect(parsed.garment_physics).toBeNull();
    expect(parsed.tech_pack).toContain('Sole_Construction');
    expect(parsed.item_name).toBe('dmodot Women Embellished Leather Slip-On Flip-Flops');
  });

  test('garment responses are unchanged by the shoe section support', () => {
    const parsed = parseStage1(TOPWEAR_RESPONSE);
    expect(parsed.garment_physics).toStartWith('[GARMENT_PHYSICS]\n');
    expect(parsed.shoe_physics).toBeNull();
    expect(parsed.item_name).toBe('Brand Tee');
  });
});
