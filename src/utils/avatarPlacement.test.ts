import { AVATAR_CONFIG, placeMaleAvatar, placeFemaleAvatar, AvatarPlacementResult, DBPlacement } from './avatarPlacement';

describe('avatarPlacement', () => {
  const containerH = 600;
  const smallContainerH = 200;
  const userHeight = 180;

  it('scales proportionally when container height shrinks', () => {
    const big = placeMaleAvatar(containerH, userHeight);
    const small = placeMaleAvatar(smallContainerH, userHeight);
    const scaleRatio = smallContainerH / containerH;
    expect(small.pxPerCm / big.pxPerCm).toBeCloseTo(scaleRatio, 2);
    expect(small.topwearY / big.topwearY).toBeCloseTo(scaleRatio, 2);
    expect(small.bottomwearY / big.bottomwearY).toBeCloseTo(scaleRatio, 2);
    expect(small.footwearY / big.footwearY).toBeCloseTo(scaleRatio, 2);
  });

  it('uses DB override if provided', () => {
    const placement: DBPlacement = {
      topwearPlacementY: 10,
      bottomwearPlacementY: 50,
      footwearPlacementY: 90,
    };
    const result = placeFemaleAvatar(containerH, 160, placement);
    expect(result.topwearY).toBeCloseTo(0.1 * 160 * result.pxPerCm, 2);
    expect(result.bottomwearY).toBeCloseTo(0.5 * 160 * result.pxPerCm, 2);
    expect(result.footwearY).toBeCloseTo(0.9 * 160 * result.pxPerCm, 2);
  });

  it('falls back to gender defaults if DB values are null', () => {
    const placement: DBPlacement = {
      topwearPlacementY: null,
      bottomwearPlacementY: null,
      footwearPlacementY: null,
    };
    const result = placeMaleAvatar(containerH, 175, placement);
    expect(result.topwearY).toBeCloseTo(0 * 175 * result.pxPerCm, 2);
    expect(result.bottomwearY).toBeCloseTo(0.37 * 175 * result.pxPerCm, 2);
    expect(result.footwearY).toBeCloseTo(0.87 * 175 * result.pxPerCm, 2);
  });

  it('enforces bottom gap and shrinks avatar if needed', () => {
    // Use a very small container to force shrink
    const tinyContainer = 100;
    const result = placeFemaleAvatar(tinyContainer, 200);
    // The avatar should have scaled down (scale < avatarScale)
    expect(result.scale).toBeLessThan(AVATAR_CONFIG.avatarScale);
    // The bottom of the avatar + gap should fit in the container
    expect(result.chinY + result.footwearY + AVATAR_CONFIG.bottomGap * tinyContainer).toBeLessThanOrEqual(tinyContainer + 1);
  });

  it('returns safeBottom true if avatar fits, false if not', () => {
    const result = placeMaleAvatar(containerH, 175);
    expect(result.safeBottom).toBe(true);
    // Artificially break the gap logic
    const badConfig = { ...AVATAR_CONFIG, bottomGap: 0.5 };
    const result2 = placeMaleAvatar(containerH, 175, undefined, badConfig);
    expect(result2.safeBottom).toBe(false);
  });
}); 