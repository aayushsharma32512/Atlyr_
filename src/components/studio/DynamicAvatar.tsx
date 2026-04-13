import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { OutfitItem } from '@/types';
import { APP_CONSTANTS } from '@/utils/constants';
import { Button } from '@/components/ui/button';
import { placeMaleAvatar, placeFemaleAvatar, AVATAR_CONFIG, DBPlacement } from '@/utils/avatarPlacement';
import { useProfile } from '@/hooks/useProfile';
import { supabase } from '@/integrations/supabase/client';
import { getAvatarHeadMetaCached } from '@/utils/avatarHeadsCache';

interface DynamicAvatarProps {
  items: OutfitItem[];
  className?: string;
  onItemSelect?: (item: OutfitItem) => void;
  onItemSwipeRight?: (item: OutfitItem) => void;
  backgroundUrl?: string;
  containerHeight?: number; // new prop
  userHeightScale?: number; // new prop
  showShadows?: boolean; // whether to render shadow/duplicate layers behind the avatar
  containerWidth?: number; // optional override for container width to aid centering in tight cards
  selectedItemType?: 'top' | 'bottom' | 'shoes' | null; // new prop for z-index management
  onSlotPositions?: (positions: { top: number; bottom: number; shoes: number; containerWidth: number }) => void; // emit slot midpoints
  layeringOrder?: Array<'top' | 'bottom' | 'shoes'>; // rendering order highest->lowest
  genderOverride?: 'male' | 'female';
  heightOverrideCm?: number;
  headImageUrlOverride?: string;
  disableSwipeGestures?: boolean;
}

interface ItemDimensions {
  width: number;
  height: number;
}

export function DynamicAvatar({
  items,
  className = "",
  onItemSelect,
  onItemSwipeRight,
  backgroundUrl,
  containerHeight = 550, // default for Studio
  userHeightScale = 0.8, // default scaling
  showShadows = true,
  containerWidth: containerWidthOverride,
  selectedItemType = null,
  onSlotPositions,
  layeringOrder,
  genderOverride,
  heightOverrideCm,
  headImageUrlOverride,
  disableSwipeGestures = false,
}: DynamicAvatarProps) {
  // Keep a ref of callback to avoid effect dependency churn
  const slotCallbackRef = useRef<typeof onSlotPositions | undefined>(onSlotPositions);
  useEffect(() => {
    slotCallbackRef.current = onSlotPositions;
  }, [onSlotPositions]);
  const [itemDimensions, setItemDimensions] = useState<Record<string, ItemDimensions>>({});
  const [headDimensions, setHeadDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [headPlacementXPct, setHeadPlacementXPct] = useState<number>(0);
  const { profile, getUserAvatarUrl, getAvatarScalingFactor, getUserGender, getSelectedAvatarId, getUserHeightCm } = useProfile();

  // Get user's avatar URL and scaling factor
  const userAvatarUrlFromProfile = getUserAvatarUrl();
  const resolvedHeadImageUrl = headImageUrlOverride ?? userAvatarUrlFromProfile;
  const userScalingFactor = getAvatarScalingFactor();
  const [headScalingCm, setHeadScalingCm] = useState<number | null>(null);
  const [chinPlacementPct, setChinPlacementPct] = useState<number>(0);

  // Swipe gesture refs
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const swipeConsumedRef = useRef<boolean>(false);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const lockAppliedRef = useRef<boolean>(false);

  const handleTouchStart = (e: React.TouchEvent, _item: OutfitItem) => {
    if (disableSwipeGestures) {
      return;
    }
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    swipeConsumedRef.current = false;
    activeTargetRef.current = e.currentTarget as unknown as HTMLElement;
    lockAppliedRef.current = false;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (disableSwipeGestures) {
      return;
    }
    // Direction lock using CSS touch-action instead of preventDefault
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!lockAppliedRef.current && Math.abs(dx) > Math.abs(dy) * 2.5) {
      // Apply touch-action: none during an active horizontal swipe to avoid scroll
      if (activeTargetRef.current) {
        activeTargetRef.current.style.touchAction = 'none';
      }
      lockAppliedRef.current = true;
    }
  };
  const handleTouchEnd = (e: React.TouchEvent, item: OutfitItem) => {
    if (disableSwipeGestures) {
      return;
    }
    const start = touchStartRef.current;
    touchStartRef.current = null;
    // Restore touch-action after gesture ends
    if (activeTargetRef.current) {
      activeTargetRef.current.style.touchAction = 'pan-y';
    }
    lockAppliedRef.current = false;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    const velocity = Math.abs(dx) / Math.max(1, dt); // px/ms

    // Edge safety: ignore if started at extreme left 16px (OS back gesture)
    if (start.x <= 16) return;

    // Angle tolerance ±20° around horizontal
    const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
    const horizontalEnough = angle <= 20;
    const distanceCommit = dx > 64; // right swipe distance
    const velocityCommit = dx > 0 && velocity >= 0.6; // right swipe flick

    if (horizontalEnough && (distanceCommit || velocityCommit)) {
      swipeConsumedRef.current = true;
      onItemSwipeRight?.(item);
    }
  };

  // Load clothing item dimensions
  // You can set loading dimensions for any item by assigning a default width/height
  // in the dimensions object before the image loads. This is typically done in the
  // img.onerror handler (for failed loads), but you can also set a "loading" value
  // before the image actually loads, so the UI can use it while waiting.

  useEffect(() => {
    const loadImageDimensions = async () => {
      setIsLoading(true);
      const dimensions: Record<string, ItemDimensions> = {};

      // Set initial loading dimensions for all items
      items.forEach(item => {
        // You can customize these loading dimensions as needed
        dimensions[item.id] = { width: 100, height: 100 };
      });

      setItemDimensions({ ...dimensions }); // Optionally update state immediately for loading

      const loadPromises = items.map(item => {
        return new Promise<void>((resolve) => {
          const img = new window.Image();
          img.onload = () => {
            dimensions[item.id] = {
              width: img.naturalWidth,
              height: img.naturalHeight
            };
            resolve();
          };
          img.onerror = () => {
            dimensions[item.id] = { width: 100, height: 100 };
            resolve();
          };
          img.src = item.imageUrl;
        });
      });
      await Promise.all(loadPromises);
      setItemDimensions(dimensions);
      setIsLoading(false);
    };
    if (items.length > 0) {
      loadImageDimensions();
    } else {
      setIsLoading(false);
    }
  }, [items]);

  // Load head dimensions
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      // Use original head dimensions without scaling
      setHeadDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      setHeadDimensions({ width: 200, height: 250 });
    };
    img.src = resolvedHeadImageUrl; // Use resolved head image here
  }, [resolvedHeadImageUrl]);

  // Load head placement_x and fallback scaling_factor (cm) from avatar_heads using selected avatar id (with cache)
  useEffect(() => {
    const fetchHeadPlacement = async () => {
      try {
        const avatarId = getSelectedAvatarId();
        if (!avatarId) {
          setHeadPlacementXPct(0);
          setHeadScalingCm(null);
          setChinPlacementPct(0);
          return;
        }
        const meta = await getAvatarHeadMetaCached(avatarId);
        setHeadPlacementXPct(meta.placement_x);
        setHeadScalingCm(meta.scaling_factor);
        setChinPlacementPct(meta.chin_placement);
      } catch (_e) {
        setHeadPlacementXPct(0);
        setHeadScalingCm(null);
        setChinPlacementPct(0);
      }
    };
    fetchHeadPlacement();
  }, [profile?.selected_avatar_id]);

  // Get items by type
  const headUrl = resolvedHeadImageUrl;
  const topItem = items.find(i => i.type === 'top');
  const bottomItem = items.find(i => i.type === 'bottom');
  const shoesItem = items.find(i => i.type === 'shoes');

  // DB placement offsets (default: 0 for top, 37 for bottom, 87 for shoes)
  const getPlacement = (item?: OutfitItem, fallback?: number): number => {
    return (item && typeof item.placement_y === 'number') ? item.placement_y : fallback ?? 0;
  };
  const placementY_top = getPlacement(topItem, -3);
  const placementY_bottom = getPlacement(bottomItem, 33);
  const placementY_shoes = getPlacement(shoesItem, 80);

  // X placement offsets (default: 0 for center)
  const getXPlacement = (item?: OutfitItem): number => {
    return (item && typeof item.placement_x === 'number') ? item.placement_x : 0;
  };
  const placementX_top = getXPlacement(topItem);
  const placementX_bottom = getXPlacement(bottomItem);
  const placementX_shoes = getXPlacement(shoesItem);

  // Use gender and height from profile, fallback to config defaults
  const gender = genderOverride ?? getUserGender();
  const userHeight = typeof heightOverrideCm === 'number' ? heightOverrideCm : getUserHeightCm();
  // Determine head length in cm from profile first (treated as cm), then fallback to avatar_heads.scaling_factor
  const profileScaleRaw = userScalingFactor; // historically a ratio (~0.17); now interpret as cm when > 1
  const resolveHeadLengthCm = () => {
    // Prefer profile value if present
    if (typeof profileScaleRaw === 'number') {
      // Back-compat: if value <= 1, treat as ratio of user height; else treat as cm
      if (profileScaleRaw <= 1) {
        return (profileScaleRaw || 0.17) * (userHeight || 175);
      }
      return profileScaleRaw;
    }
    // Fallback to avatar head default scaling_factor (already in cm)
    if (typeof headScalingCm === 'number') return headScalingCm;
    // Final fallback: a reasonable default head length in cm
    return 30; // default cm
  };
  const headLengthCm = resolveHeadLengthCm();

  // Calculate userHeightPx (real-world user height mapped to container)
  const userHeightPx = userHeightScale * containerHeight;
  // Desired head height in px using cm model with per-user head/body multiplier
  const headToBodyRatio = (profile && typeof (profile as any).head_to_body_ratio === 'number') ? (profile as any).head_to_body_ratio : 1.0;
  const desiredHeadHeightPx = (userHeightPx / (userHeight || 175)) * headLengthCm * headToBodyRatio;
  // Actual head image height in px (from loaded image)
  const headImageHeightPx = headDimensions.height || 1; // avoid div by zero
  // Scale to apply to all items so head fits desired size
  const headScale = desiredHeadHeightPx / headImageHeightPx;

  // Scaled dimensions for all items
  const headDim = {
    width: headDimensions.width * headScale,
    height: headDimensions.height * headScale,
  };
  // Head horizontal offset in px based on placement_x percent
  const headXOffsetPx = (headPlacementXPct / 100) * (headDim.width || 0);
  // Compute pixels-per-centimeter based on container and user height
  const pxPerCm = (() => {
    const safeUserHeight = userHeight || 175; // cm
    const userHeightPx = userHeightScale * containerHeight;
    return userHeightPx / safeUserHeight;
  })();

  // Helper to compute scaled dimensions based on image_length when available
  const computeItemDim = (item?: OutfitItem) => {
    if (!item) return undefined;
    const dims = itemDimensions[item.id];
    if (!dims) return undefined;
    const hasValidImageLength = typeof (item as any).image_length === 'number' && (item as any).image_length! > 0;
    if (hasValidImageLength) {
      const targetHeight = pxPerCm * ((item as any).image_length as number);
      const aspect = dims.width / (dims.height || 1);
      const targetWidth = targetHeight * aspect;
      return { width: targetWidth, height: targetHeight };
    }
    // Fallback to head-based scale if no image_length
    return { width: dims.width * headScale, height: dims.height * headScale };
  };

  const topDim = computeItemDim(topItem);
  const bottomDim = computeItemDim(bottomItem);
  const shoesDim = computeItemDim(shoesItem);

  // Y placement logic
  // Head: top = 0
  // Chin origin (chinPx) derived from head height and chin_placement percentage
  // Topwear: top = chinPx + (placementY_top / 100) * userHeightPx
  // Bottomwear: top = chinPx + (placementY_bottom / 100) * userHeightPx
  // Shoes: top = chinPx + (placementY_shoes / 100) * userHeightPx
  const headY = 0;
  const chinPx = headDim.height * (1 - (chinPlacementPct / 100));
  const topwearY = chinPx + (placementY_top / 100) * userHeightPx;
  const bottomwearY = chinPx + (placementY_bottom / 100) * userHeightPx;
  const footwearY = chinPx + (placementY_shoes / 100) * userHeightPx;

  // Container width: max of all item widths (fallback 350px) unless overridden
  const computedContainerWidth = containerWidthOverride ?? Math.max(
    headDim.width || 0,
    topDim?.width || 0,
    bottomDim?.width || 0,
    shoesDim?.width || 0,
    350
  );

  // Emit slot midpoint Y positions for external positioning of controls
  useEffect(() => {
    if (!slotCallbackRef.current) return;
    const fallbackTopH = pxPerCm * 40; // cm to px approx for visual fallback
    const fallbackBottomH = pxPerCm * 60;
    const fallbackShoesH = pxPerCm * 20;
    const midTop = topwearY + ((topDim?.height ?? fallbackTopH) / 2);
    const midBottom = bottomwearY + ((bottomDim?.height ?? fallbackBottomH) / 2);
    const midShoes = footwearY + ((shoesDim?.height ?? fallbackShoesH) / 2);
    slotCallbackRef.current({ top: midTop, bottom: midBottom, shoes: midShoes, containerWidth: computedContainerWidth });
  }, [topwearY, bottomwearY, footwearY, topDim?.height, bottomDim?.height, shoesDim?.height, computedContainerWidth, pxPerCm]);

  // Helper to calculate z-index based on item type and selection state
  const getItemZIndex = (itemType: 'top' | 'bottom' | 'shoes') => {
    // Determine base mapping: either from layeringOrder (highest first) or default top>bottom>shoes
    const defaultOrder: Array<'top' | 'bottom' | 'shoes'> = ['top', 'bottom', 'shoes'];
    const order = (layeringOrder && layeringOrder.length > 0) ? layeringOrder : defaultOrder;
    // Highest gets 3, then 2, then 1
    const highest = order[0];
    const middle = order[1];
    const lowest = order[2];
    let baseZIndex = 2;
    if (itemType === highest) baseZIndex = 3;
    else if (itemType === middle) baseZIndex = 2;
    else if (itemType === lowest) baseZIndex = 1;
    // Selection sits above all
    return selectedItemType === itemType ? 4 : baseZIndex;
  };

  // Helper to get image style for each layer with x-placement based on rendered width (no shadow)
  const getLayerStyle = (
    y: number,
    itemType: 'top' | 'bottom' | 'shoes',
    dim?: { width: number; height: number },
    xPlacementPercent: number = 0
  ) => {
    if (!dim) return { display: 'none' };
    const xOffset = (xPlacementPercent / 100) * dim.width;
    return {
      position: 'absolute' as const,
      left: `calc(50% + ${xOffset}px)`,
      transform: 'translateX(-50%)',
      top: y,
      width: dim.width,
      height: dim.height,
      zIndex: getItemZIndex(itemType),
      objectFit: 'contain' as const,
      pointerEvents: (onItemSelect ? 'auto' : 'none') as React.CSSProperties['pointerEvents'],
      cursor: onItemSelect ? 'pointer' : 'default',
      touchAction: disableSwipeGestures ? ('auto' as React.CSSProperties['touchAction']) : ('pan-y' as React.CSSProperties['touchAction']),
    };
  };

  // Shadow style (shape-following, horizontal emphasis). Pointer-events disabled.
  const getShadowStyle = (
    y: number,
    zIndex: number,
    dim?: { width: number; height: number },
    xPlacementPercent: number = 0
  ) => {
    if (!dim) return { display: 'none' };
    const xOffset = (xPlacementPercent / 100) * dim.width;
    return {
      position: 'absolute' as const,
      left: `calc(50% + ${xOffset}px)`,
      transform: 'translateX(-50%)',
      top: y,
      width: dim.width,
      height: dim.height,
      zIndex,
      objectFit: 'contain' as const,
      pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
      filter: 'drop-shadow(-8px 0 20px rgba(0,0,0,0.2)) drop-shadow(8px 0 20px rgba(0,0,0,0.2))',
    } as React.CSSProperties;
  };

  // Head: align chin (bottom of image) to chinY (no shadow)
  const headStyle = {
    position: 'absolute' as const,
    left: `calc(50% + ${headXOffsetPx}px)`,
    transform: 'translateX(-50%)', // removed scale(headScale)
    top: headY,
    width: headDim.width,
    height: headDim.height,
    zIndex: 6,
    objectFit: 'contain' as const,
    pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
  };

  // Head shadow style
  const headShadowStyle = {
    position: 'absolute' as const,
    left: `calc(50% + ${headXOffsetPx}px)`,
    transform: 'translateX(-50%)',
    top: headY,
    width: headDim.width,
    height: headDim.height,
    zIndex: 5,
    objectFit: 'contain' as const,
    pointerEvents: 'none' as React.CSSProperties['pointerEvents'],
    filter: 'drop-shadow(-8px 0 20px rgba(0,0,0,0.2)) drop-shadow(8px 0 20px rgba(0,0,0,0.2))',
  } as React.CSSProperties;

  /**
   * This block checks if the avatar is still loading (isLoading is true).
   * If so, it returns a placeholder UI instead of the actual avatar.
   * 
   * What it does:
   * - Renders a container <div> with a fixed height (400px) and width (250px), centered content, and any extra classes passed via `className`.
   * - Inside this container, it renders another <div> (width: 8rem, height: 10rem) with a background color and rounded corners, also centered.
   * - Inside the inner <div>, it displays a large user icon emoji ("👤") as a visual placeholder.
   * 
   * Example:
   * Suppose the avatar images are still being loaded from the server. While loading, instead of showing a blank space or broken images, the user sees:
   * 
   * +---------------------------------------------------+
   * |                                                   |
   * |             +--------------------------+          |
   * |             |                          |          |
   * |             |           👤              |          |
   * |             |                          |          |
   * |             +--------------------------+          |
   * |                                                   |
   * +---------------------------------------------------+
   * 
   * This gives a clear, visually pleasant indication that the avatar is loading.
   */
  if (isLoading) {
    return (
      <div className={`relative bg-transparent rounded-lg flex items-center justify-center ${className}`} style={{ height: containerHeight, width: 350 }}>
        <div className="w-32 h-40 bg-background rounded-lg flex items-center justify-center">
          <span className="text-6xl">👤</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative bg-transparent ${className}`} style={{ height: containerHeight, width: computedContainerWidth }}>
      {/* Background Image */}
      {backgroundUrl && (
        <img
          src={backgroundUrl}
          alt="Background"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0
          }}
          className="select-none"
        />
      )}
      
      {/* Shadow layer: not clipped (renders behind items) */}
      {showShadows && shoesItem && shoesDim && (
        <img
          src={shoesItem.imageUrl}
          alt={shoesItem.description}
          style={getShadowStyle(footwearY, 0, shoesDim, placementX_shoes)}
          className="select-none"
        />
      )}
      {showShadows && bottomItem && bottomDim && (
        <img
          src={bottomItem.imageUrl}
          alt={bottomItem.description}
          style={getShadowStyle(bottomwearY, 0, bottomDim, placementX_bottom)}
          className="select-none"
        />
      )}
      {showShadows && topItem && topDim && (
        <img
          src={topItem.imageUrl}
          alt={topItem.description}
          style={getShadowStyle(topwearY, 0, topDim, placementX_top)}
          className="select-none"
        />
      )}
      {/* Head shadow */}
      {showShadows && (
        <img
          src={headUrl}
          alt="Avatar head shadow"
          style={headShadowStyle}
          className="select-none"
        />
      )}

      {/* Avatar content layer: clipped to container */}
      <div className="relative overflow-hidden" style={{ height: containerHeight, width: computedContainerWidth }}>
      {/* Shoes (footwear) */}
      {shoesItem && shoesDim && (
        <img
          src={shoesItem.imageUrl}
          alt={shoesItem.description}
          style={getLayerStyle(footwearY, 'shoes', shoesDim, placementX_shoes)}
          className="select-none"
          onClick={(e) => { if (swipeConsumedRef.current) { e.preventDefault(); return; } onItemSelect?.(shoesItem); }}
          onTouchStart={(e) => handleTouchStart(e, shoesItem)}
          onTouchMove={handleTouchMove}
          onTouchEnd={(e) => handleTouchEnd(e, shoesItem)}
        />
      )}
      {/* Bottoms */}
      {bottomItem && bottomDim && (
        <img
          src={bottomItem.imageUrl}
          alt={bottomItem.description}
          style={getLayerStyle(bottomwearY, 'bottom', bottomDim, placementX_bottom)}
          className="select-none"
          onClick={(e) => { if (swipeConsumedRef.current) { e.preventDefault(); return; } onItemSelect?.(bottomItem); }}
          onTouchStart={(e) => handleTouchStart(e, bottomItem)}
          onTouchMove={handleTouchMove}
          onTouchEnd={(e) => handleTouchEnd(e, bottomItem)}
        />
      )}
      {/* Tops */}
      {topItem && topDim && (
        <img
          src={topItem.imageUrl}
          alt={topItem.description}
          style={getLayerStyle(topwearY, 'top', topDim, placementX_top)}
          className="select-none"
          onClick={(e) => { if (swipeConsumedRef.current) { e.preventDefault(); return; } onItemSelect?.(topItem); }}
          onTouchStart={(e) => handleTouchStart(e, topItem)}
          onTouchMove={handleTouchMove}
          onTouchEnd={(e) => handleTouchEnd(e, topItem)}
        />
      )}
      {/* Head (silhouette) */}
      <img
        src={headUrl}
        alt="Avatar head"
        style={headStyle}
        className="select-none"
      />
      </div>
    </div>
  );
}
