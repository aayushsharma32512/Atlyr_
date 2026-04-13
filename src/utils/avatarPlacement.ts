/**
 * avatarPlacement.ts
 *
 * Utilities for proportional avatar layer placement in vertically-variable containers.
 *
 * BUSINESS RULES:
 * - All Y positions are relative to the chin (origin Y = 0).
 * - Avatar height = AVATAR_SCALE × containerHeight (default 0.75, configurable)
 * - Default userHeight if profile.height_cm is null: Male = 175 cm, Female = 162 cm
 * - Chin Y = CHIN_TOP_GAP × containerHeight + 0.13 × userHeight × pxPerCm
 * - Offsets from chin (positive downward, negative upward):
 *   Men: topwear 0%, bottomwear 37%, footwear 87%
 *   Women: topwear 0%, bottomwear 35%, footwear 87%
 * - If DB value (placement_y) is present, use it (as integer percent of user height)
 * - BOTTOM_GAP default 0.15 (15% container)—ensure shoes + gap ≤ container bottom; shrink avatar if overflow
 *
 * CAVEATS:
 * - Extreme user heights may cause visual distortion
 * - If gender is missing, default to male logic
 * - Oversized footwear images may still overflow
 * - Neck offsets are not implemented
 *
 * Usage: See exported functions and types below.
 */

export const AVATAR_CONFIG = {
  avatarScale: 1.0,
  chinTopGap: 0.10,
  bottomGap: 0.15,
  defaultsMen: {
    topwear: 0,
    bottomwear: 37,
    footwear: 87,
  },
  defaultsWomen: {
    topwear: 0,
    bottomwear: 35,
    footwear: 87,
  },
  defaultHeightMen: 175,
  defaultHeightWomen: 162,
};

/**
 * Placement input from DB for a product.
 */
export interface DBPlacement {
  topwearPlacementY?: number | null; // integer percent (0-100)
  bottomwearPlacementY?: number | null;
  footwearPlacementY?: number | null;
}

/**
 * Output of placement calculation.
 */
export interface AvatarPlacementResult {
  chinY: number; // px from top of container
  pxPerCm: number;
  topwearY: number; // px from chin (origin)
  bottomwearY: number;
  footwearY: number;
  totalAvatarH: number; // px
  safeBottom: boolean; // true if avatar+gap fits in container
  scale: number; // final scale applied (may be < AVATAR_SCALE if shrink needed)
}

/**
 * Calculate avatar placement for a given gender.
 * @param gender 'male' | 'female'
 * @param containerH_px Height of the container in px
 * @param userHeight_cm User height in cm (optional)
 * @param productPlacement Placement info from DB (placement_y as integer percent)
 * @param config Optional config overrides
 * @returns AvatarPlacementResult
 */
export function placeAvatar(
  gender: 'male' | 'female',
  containerH_px: number,
  userHeight_cm?: number | null,
  productPlacement?: DBPlacement,
  config?: Partial<typeof AVATAR_CONFIG>
): AvatarPlacementResult {
  const cfg = { ...AVATAR_CONFIG, ...config };
  const avatarH = cfg.avatarScale * containerH_px;
  const userHeight = userHeight_cm ?? (gender === 'female' ? cfg.defaultHeightWomen : cfg.defaultHeightMen);
  let pxPerCm = avatarH / userHeight;

  // Chin Y calculation (from top of container)
  const chinY = cfg.chinTopGap * containerH_px + 0.13 * userHeight * pxPerCm;


  // Placement percentages (prefer DB, else default)
  const defaults = gender === 'female' ? cfg.defaultsWomen : cfg.defaultsMen;
  const topwearPct = productPlacement?.topwearPlacementY ?? defaults.topwear;
  const bottomwearPct = productPlacement?.bottomwearPlacementY ?? defaults.bottomwear;
  const footwearPct = productPlacement?.footwearPlacementY ?? defaults.footwear;

  // Y positions from chin (origin)
  let topwearY = (topwearPct / 100) * userHeight * pxPerCm;
  let bottomwearY = (bottomwearPct / 100) * userHeight * pxPerCm;
  let footwearY = (footwearPct / 100) * userHeight * pxPerCm;

  // Bottom gap enforcement
  let scale = cfg.avatarScale;
  let totalAvatarH = avatarH;
  let safeBottom = true;
  const maxAttempts = 5;
  let attempt = 0;
  while (
    (chinY + footwearY + cfg.bottomGap * containerH_px > containerH_px) &&
    attempt < maxAttempts
  ) {
    // Shrink everything by 10%
    scale *= 0.9;
    totalAvatarH = scale * containerH_px;
    pxPerCm = totalAvatarH / userHeight;
    topwearY = (topwearPct / 100) * userHeight * pxPerCm;
    bottomwearY = (bottomwearPct / 100) * userHeight * pxPerCm;
    footwearY = (footwearPct / 100) * userHeight * pxPerCm;
    attempt++;
    if (chinY + footwearY + cfg.bottomGap * containerH_px <= containerH_px) {
      safeBottom = true;
      break;
    } else {
      safeBottom = false;
    }
  }

  return {
    chinY,
    pxPerCm,
    topwearY,
    bottomwearY,
    footwearY,
    totalAvatarH,
    safeBottom,
    scale,
  };
}

/**
 * Place male avatar layers.
 */
export function placeMaleAvatar(
  containerH_px: number,
  userHeight_cm?: number | null,
  productPlacement?: DBPlacement,
  config?: Partial<typeof AVATAR_CONFIG>
): AvatarPlacementResult {
  return placeAvatar('male', containerH_px, userHeight_cm, productPlacement, config);
}

/**
 * Place female avatar layers.
 */
export function placeFemaleAvatar(
  containerH_px: number,
  userHeight_cm?: number | null,
  productPlacement?: DBPlacement,
  config?: Partial<typeof AVATAR_CONFIG>
): AvatarPlacementResult {
  return placeAvatar('female', containerH_px, userHeight_cm, productPlacement, config);
} 