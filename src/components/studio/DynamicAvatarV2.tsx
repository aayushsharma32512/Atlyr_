import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { OutfitItem } from "@/types";
import { DEFAULT_VISIBLE_SEGMENTS as STUDIO_DEFAULT_VISIBLE_SEGMENTS, MANNEQUIN_SKIN_HEXES } from "@/features/studio/constants";

export type MannequinSegmentName = "head" | "neck" | "torso" | "arm_left" | "arm_right" | "legs" | "feet";
export type MannequinZoneName = "top" | "bottom" | "shoes";

type SegmentName = MannequinSegmentName;
type ZoneName = MannequinZoneName;

interface SegmentConfig {
  lengthPct: number;
  placementYPct: number;
  zIndex: number;
  asset: string;
  svg: string;
  xOffsetPct?: number;
}

interface Dimensions {
  width: number;
  height: number;
}

const HEAD_CHIN_OFFSET_RATIO = 0.0945;
const HEAD_LENGTH_RATIO = 0.1515;
const DEFAULT_USER_HEIGHT_CM = {
  male: 175,
  female: 163,
} as const;
const DEFAULT_USER_HEIGHT_SCALE = 0.8;
const HEAD_TO_BODY_RATIO = 1.0;

const MANNEQUIN_SEGMENTS: Record<SegmentName, SegmentConfig> = {
  head: {
    lengthPct: 15.15,
    placementYPct: -13.7,
    zIndex: 6,
    asset: new URL("../../../mnqassets/head.png", import.meta.url).href,
    svg: new URL("../../../mnqassetssvg/head.svg", import.meta.url).href,
  },
  neck: {
    lengthPct: 5.79,
    placementYPct: -1.3,
    zIndex: 5,
    asset: new URL("../../../mnqassets/neck.png", import.meta.url).href,
    svg: new URL("../../../mnqassetssvg/neck.svg", import.meta.url).href,
  },
  torso: {
    lengthPct: 42.73,
    placementYPct: 0.7,
    zIndex: 4,
    asset: new URL("../../../mnqassets/torso.png", import.meta.url).href,
    svg: new URL("../../../mnqassetssvg/torso.svg", import.meta.url).href,
  },
  arm_left: {
    lengthPct: 32.21,
    placementYPct: 14.3,
    zIndex: 5,
    asset: new URL("../../../mnqassets/arm_left.png", import.meta.url).href,
    svg: new URL("../../../mnqassetssvg/arm_left.svg", import.meta.url).href,
    xOffsetPct: -0.142,
  },
  arm_right: {
    lengthPct: 32.21,
    placementYPct: 14.3,
    zIndex: 5,
    asset: new URL("../../../mnqassets/arm_right.png", import.meta.url).href,
    svg: new URL("../../../mnqassetssvg/arm_right.svg", import.meta.url).href,
    xOffsetPct: 0.142,
  },
  legs: {
    lengthPct: 54.98,
    placementYPct: 25.3,
    zIndex: 2,
    asset: new URL("../../../mnqassets/legs.png", import.meta.url).href,
    svg: new URL("../../../mnqassetssvg/legs.svg", import.meta.url).href,
  },
  feet: {
    lengthPct: 15.82,
    placementYPct: 76.1,
    zIndex: 3,
    asset: new URL("../../../mnqassets/feet.png", import.meta.url).href,
    svg: new URL("../../../mnqassetssvg/feet.svg", import.meta.url).href,
  },
};

const SKIN_FILL_HEXES = MANNEQUIN_SKIN_HEXES;

interface DynamicAvatarV2Props {
  className?: string;
  containerHeight?: number;
  containerWidth?: number;
  gender?: "male" | "female";
  userHeightCmOverride?: number;
  userHeightScale?: number;
  visibleSegments?: SegmentName[];
  items?: OutfitItem[];
  itemOpacity?: number;
  zoneAssetOverrides?: Partial<Record<ZoneName, SegmentName[]>>;
  useSvgMannequin?: boolean;
  skinToneValue?: number;
  blurEnabled?: boolean;
  blurAmount?: number;
  blurZIndex?: number;
}

export function DynamicAvatarV2({
  className,
  containerHeight = 460,
  containerWidth = 320,
  gender = "female",
  userHeightCmOverride,
  userHeightScale = DEFAULT_USER_HEIGHT_SCALE,
  visibleSegments = STUDIO_DEFAULT_VISIBLE_SEGMENTS as SegmentName[],
  items,
  itemOpacity = 1,
  zoneAssetOverrides,
  useSvgMannequin = false,
  skinToneValue = 0.3,
  blurEnabled = false,
  blurAmount = 5,
  blurZIndex = 1,
}: DynamicAvatarV2Props) {
  const [dimensions, setDimensions] = useState<Record<SegmentName, Dimensions>>({} as Record<SegmentName, Dimensions>);
  const [assetsReady, setAssetsReady] = useState(false);
  const [svgMarkup, setSvgMarkup] = useState<Record<SegmentName, string>>({} as Record<SegmentName, string>);
  const [itemDimensions, setItemDimensions] = useState<Record<string, Dimensions>>({});
  const [itemsReady, setItemsReady] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let cancelled = false;
    const loaders = Object.entries(MANNEQUIN_SEGMENTS).map(([name, config]) => {
      return Promise.all([
        new Promise<{ name: SegmentName; dimensions: Dimensions }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ name: name as SegmentName, dimensions: { width: img.naturalWidth, height: img.naturalHeight } });
          img.onerror = () => resolve({ name: name as SegmentName, dimensions: { width: 100, height: 100 } });
          img.src = config.asset;
        }),
        fetch(config.svg)
          .then((response) => response.text())
          .then((content) => ({ name: name as SegmentName, svg: content }))
          .catch(() => ({ name: name as SegmentName, svg: "" })),
      ]);
    });
    Promise.all(loaders).then((results) => {
      if (cancelled) return;
      const nextDimensions: Partial<Record<SegmentName, Dimensions>> = {};
      const nextSvg: Partial<Record<SegmentName, string>> = {};
      results.forEach(([imgEntry, svgEntry]) => {
        nextDimensions[imgEntry.name] = imgEntry.dimensions;
        nextSvg[svgEntry.name] = svgEntry.svg;
      });
      setDimensions(nextDimensions as Record<SegmentName, Dimensions>);
      setSvgMarkup(nextSvg as Record<SegmentName, string>);
      setAssetsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!items || items.length === 0 || typeof window === "undefined") {
      setItemDimensions({});
      setItemsReady(true);
      return;
    }
    let cancelled = false;
    setItemsReady(false);
    const loaders = items.map((item) => {
      return new Promise<{ id: string; dimensions: Dimensions }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ id: item.id, dimensions: { width: img.naturalWidth, height: img.naturalHeight } });
        img.onerror = () => resolve({ id: item.id, dimensions: { width: 120, height: 120 } });
        img.src = item.imageUrl;
      });
    });
    Promise.all(loaders).then((results) => {
      if (cancelled) return;
      const mapped: Record<string, Dimensions> = {};
      results.forEach((entry) => {
        mapped[entry.id] = entry.dimensions;
      });
      setItemDimensions(mapped);
      setItemsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const userHeightCm = userHeightCmOverride ?? DEFAULT_USER_HEIGHT_CM[gender];
  const userHeightPx = userHeightScale * containerHeight;
  const pxPerCm = userHeightPx / userHeightCm;

  const headDimensions = dimensions.head ?? { width: 1, height: 1 };
  const torsoDimensions = dimensions.torso ?? { width: 1, height: 1 };
  const headLengthCm = userHeightCm * HEAD_LENGTH_RATIO;
  const desiredHeadHeightPx = (pxPerCm * headLengthCm) * HEAD_TO_BODY_RATIO;
  const headScale = desiredHeadHeightPx / headDimensions.height;
  const scaledHead = {
    width: headDimensions.width * headScale,
    height: headDimensions.height * headScale,
  };
  const chinPx = scaledHead.height * (1 - HEAD_CHIN_OFFSET_RATIO);

  const overrideSegments = useMemo(() => {
    if (!zoneAssetOverrides) return undefined;
    const flattened = Object.values(zoneAssetOverrides)
      .filter((segments): segments is SegmentName[] => Array.isArray(segments) && segments.length > 0)
      .flat();
    if (!flattened.length) return undefined;
    return Array.from(new Set(flattened));
  }, [zoneAssetOverrides]);

  const segmentsToRender = overrideSegments ?? visibleSegments;

  const visibleSet = useMemo(() => new Set<SegmentName>(segmentsToRender), [segmentsToRender]);

  const clampedSkinTone = Math.min(1, Math.max(0, skinToneValue));
  const skinBaseLightness = 85 - clampedSkinTone * 40; // 85 -> 45
  const skinSaturation = 35 + clampedSkinTone * 25; // 35 -> 60
  const skinHue = 28; // warm
  const skinColor = `hsl(${skinHue} ${skinSaturation}% ${skinBaseLightness}%)`;

  const sanitizedSvg = useMemo(() => {
    const result: Partial<Record<SegmentName, string>> = {};
    (Object.keys(svgMarkup) as SegmentName[]).forEach((segment) => {
      const raw = svgMarkup[segment];
      if (!raw) return;
      let cleaned = raw;
      cleaned = cleaned.replace(/<rect[^>]*fill="#ffffff"[^>]*>/gi, "");
      cleaned = cleaned.replace(/stroke="#000000"/gi, 'stroke="var(--mannequin-outline)"');
      cleaned = cleaned.replace(/fill="#[0-9a-fA-F]{3,6}"/gi, (match) => {
        const lower = match.toLowerCase();
        const hex = lower.match(/#[0-9a-f]{3,6}/)?.[0];
        if (hex && SKIN_FILL_HEXES.has(hex)) {
          return 'fill="var(--mannequin-skin)"';
        }
        return match;
      });
      cleaned = cleaned
        .replace(/width="[^"]*"/i, 'width="100%"')
        .replace(/height="[^"]*"/i, 'height="100%"')
        .replace(/<svg /i, '<svg preserveAspectRatio="xMidYMid meet" ');
      result[segment] = cleaned;
    });
    return result as Record<SegmentName, string>;
  }, [svgMarkup]);

  const renderSegment = (name: SegmentName) => {
    if (!assetsReady || !visibleSet.has(name)) return null;
    const config = MANNEQUIN_SEGMENTS[name];
    const base = dimensions[name];
    if (!base) return null;

    const commonStyle = (width: number, height: number, top: number, xOffset = 0) => ({
      position: "absolute" as const,
      left: "50%",
      transform: `translateX(calc(-50% + ${xOffset}px))`,
      top,
      width,
      height,
      zIndex: config.zIndex,
      pointerEvents: "none" as const,
    });

    const renderSvgLayer = (width: number, height: number, top: number, xOffset = 0) => {
      const markup = sanitizedSvg[name];
      if (!markup) return null;
      const styledMarkup = markup
        .replace(/var\(--mannequin-skin\)/g, skinColor)
        .replace(/var\(--mannequin-outline\)/g, skinColor)
        .replace(/fill="#[0-9a-fA-F]{3,6}"/g, (match) => {
          if (match.includes("#ffffff") || match.includes("#fdfdfd")) {
            return 'fill="transparent"';
          }
          return match;
        });
      return (
        <div
          key={`${name}-svg`}
          aria-label={`${name} svg segment`}
          style={{
            ...commonStyle(width, height, top, xOffset),
            color: skinColor,
          }}
          className="mannequin-svg-layer"
          dangerouslySetInnerHTML={{ __html: styledMarkup }}
        />
      );
    };

    if (name === "head") {
      const top = 0;
      if (useSvgMannequin) {
        return renderSvgLayer(scaledHead.width, scaledHead.height, top);
      }
      return (
        <img
          key={name}
          src={config.asset}
          alt={name}
          className="select-none"
          style={{
            ...commonStyle(scaledHead.width, scaledHead.height, top),
            objectFit: "contain",
          }}
        />
      );
    }

    const lengthPx = (config.lengthPct / 100) * userHeightPx;
    const aspectRatio = base.width / (base.height || 1);
    const widthPx = lengthPx * aspectRatio;
    const top = chinPx + (config.placementYPct / 100) * userHeightPx;

    let xOffsetPx = 0;
    if (name === "arm_left" || name === "arm_right") {
      const torsoHeightPx = (MANNEQUIN_SEGMENTS.torso.lengthPct / 100) * userHeightPx;
      const torsoAspect = torsoDimensions.width / (torsoDimensions.height || 1);
      const renderedTorsoWidth = torsoHeightPx * torsoAspect;
      const offsetPercent = config.xOffsetPct ?? 0;
      xOffsetPx = offsetPercent * renderedTorsoWidth;
    }

    if (useSvgMannequin) {
      return renderSvgLayer(widthPx, lengthPx, top, xOffsetPx);
    }

    return (
      <img
        key={name}
        src={config.asset}
        alt={name}
        className="select-none"
        style={{
          ...commonStyle(widthPx, lengthPx, top, xOffsetPx),
          objectFit: "contain",
        }}
      />
    );
  };

  const clothingOpacity = Math.max(0, Math.min(1, itemOpacity));

  const getPlacement = (item?: OutfitItem, fallback?: number) => {
    if (item && typeof item.placement_y === "number") return item.placement_y;
    return typeof fallback === "number" ? fallback : 0;
  };
  const getPlacementX = (item?: OutfitItem) => {
    if (item && typeof item.placement_x === "number") return item.placement_x;
    return 0;
  };

  const topItems = (items ?? []).filter((entry) => entry.type === "top");
  const bottomItems = (items ?? []).filter((entry) => entry.type === "bottom");
  const shoeItems = (items ?? []).filter((entry) => entry.type === "shoes");

  const computeItemDim = (item?: OutfitItem) => {
    if (!item) return undefined;
    const dims = itemDimensions[item.id];
    if (!dims) return undefined;
    const aspect = dims.width / (dims.height || 1);
    if (typeof item.image_length === "number" && item.image_length > 0) {
      const targetHeight = pxPerCm * item.image_length;
      return { width: targetHeight * aspect, height: targetHeight };
    }
    return { width: dims.width * headScale, height: dims.height * headScale };
  };

  const getLayerStyle = (dim: { width: number; height: number }, y: number, zIndex: number, placementXPercent: number) => {
    const xOffset = (placementXPercent / 100) * dim.width;
    return {
      position: "absolute" as const,
      left: `calc(50% + ${xOffset}px)`,
      transform: "translateX(-50%)",
      top: y,
      width: dim.width,
      height: dim.height,
      zIndex,
      objectFit: "contain" as const,
      pointerEvents: "none" as const,
      opacity: clothingOpacity,
    };
  };

  type ClothingLayer = {
    key: string;
    style: ReturnType<typeof getLayerStyle>;
    src: string;
    alt: string;
  };

  const buildLayers = (
    zoneItems: OutfitItem[],
    fallbackPlacement: number,
    baseZ: number,
    zIncrement = 1,
  ): ClothingLayer[] => {
    return zoneItems
      .map((item, index) => {
        const dims = computeItemDim(item);
        if (!dims) return null;
        const y = chinPx + (getPlacement(item, fallbackPlacement) / 100) * userHeightPx;
        return {
          key: `${item.id}-${index}`,
          style: getLayerStyle(dims, y, baseZ + index * zIncrement, getPlacementX(item)),
          src: item.imageUrl,
          alt: item.description ?? item.product_name ?? "Outfit item",
        };
      })
      .filter((layer): layer is ClothingLayer => Boolean(layer));
  };

  const topLayers = buildLayers(topItems, -3, 40);
  const bottomLayers = buildLayers(bottomItems, 33, 30);
  const shoeLayers = buildLayers(shoeItems, 80, 20);

  const clothingLayers: ClothingLayer[] = itemsReady ? [...bottomLayers, ...shoeLayers, ...topLayers] : [];

  return (
    <div className={cn("relative bg-transparent", className)} style={{ height: containerHeight, width: containerWidth }}>
      {!assetsReady ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
          Loading mannequin assets…
        </div>
      ) : null}
      {segmentsToRender.map((segment) => renderSegment(segment))}
      {clothingLayers.map((layer) =>
        layer ? (
          <img key={layer.key as string} src={layer.src} alt={layer.alt} style={layer.style} className="select-none" />
        ) : null,
      )}
      {blurEnabled ? (
        <div
          className="pointer-events-none"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: blurZIndex,
            backdropFilter: `blur(${blurAmount}px)`,
            WebkitBackdropFilter: `blur(${blurAmount}px)`,
          }}
        />
      ) : null}
      {!itemsReady && items && items.length > 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px]">
          Loading outfit assets…
        </div>
      ) : null}
    </div>
  );
}

export default DynamicAvatarV2;
