import type { OutfitItem } from "@/types";
import type { MannequinSegmentName, MannequinZoneName } from "@/components/studio/DynamicAvatarV2";

export type PreviewOutfitItem = OutfitItem & {
  displayName: string;
  layerZone: MannequinZoneName;
  layerRole: "base" | "inner" | "outer";
  mannequinAssets: MannequinSegmentName[];
  defaultEnabled?: boolean;
};

export const DEFAULT_ZONE_SEGMENTS: Record<MannequinZoneName, MannequinSegmentName[]> = {
  top: ["head", "neck", "torso", "arm_left", "arm_right"],
  bottom: ["legs", "feet"],
  shoes: ["feet"],
};

const MOCK_TOP_IMAGE = new URL("../../Flatlays/Topwear/BASIC_HEAVYWEIGHT_T-SHIRT_6_bg_removed.png", import.meta.url).href;
const MOCK_TOP_LAYER_IMAGE = new URL("../../Flatlays/Topwear/COTTON_AND_SILK_SWEATER_6_bg_removed.png", import.meta.url).href;
const MOCK_BOTTOM_IMAGE = new URL("../../Flatlays/Bottomwear/100__LINEN_PLEATED_TROUSERS_7_bg_removed.png", import.meta.url).href;
const MOCK_BOTTOM_LAYER_IMAGE = new URL("../../Flatlays/Bottomwear/COMFORT_FIT_JOGGER_WAIST_TROUSERS_6_bg_removed.png", import.meta.url).href;
const MOCK_SHOES_IMAGE = new URL("../../Flatlays/Footwear/CASUAL_LEATHER_LOAFERS_2_bg_removed.png", import.meta.url).href;
const MOCK_SHOES_LAYER_IMAGE = new URL("../../Flatlays/Footwear/CHUNKY_CHELSEA_BOOTS_7_bg_removed.png", import.meta.url).href;

export const MOCK_OUTFIT_ITEMS: PreviewOutfitItem[] = [
  {
    id: "mock-top-basic-tee",
    displayName: "Base Topwear",
    type: "top",
    brand: "Mock",
    size: "M",
    price: 0,
    currency: "USD",
    imageUrl: MOCK_TOP_IMAGE,
    description: "Mock heavyweight tee",
    color: "white",
    placement_y: 1,
    placement_x: 0,
    image_length: 58,
    layerZone: "top",
    layerRole: "base",
    mannequinAssets: ["head", "neck", "torso", "arm_left", "arm_right"],
    defaultEnabled: true,
  },
  {
    id: "mock-top-layer-jacket",
    displayName: "Outer Jacket Layer",
    type: "top",
    brand: "Mock",
    size: "L",
    price: 0,
    currency: "USD",
    imageUrl: MOCK_TOP_LAYER_IMAGE,
    description: "Mock structured jacket",
    color: "navy",
    placement_y: 1,
    placement_x: 0,
    image_length: 64,
    layerZone: "top",
    layerRole: "outer",
    mannequinAssets: ["head", "neck"],
    defaultEnabled: false,
  },
  {
    id: "mock-bottom-linen-trouser",
    displayName: "Base Bottomwear",
    type: "bottom",
    brand: "Mock",
    size: "32",
    price: 0,
    currency: "USD",
    imageUrl: MOCK_BOTTOM_IMAGE,
    description: "Mock linen pleated trousers",
    color: "camel",
    placement_y: 33,
    placement_x: 0,
    image_length: 98,
    layerZone: "bottom",
    layerRole: "base",
    mannequinAssets: ["legs", "feet"],
    defaultEnabled: true,
  },
  {
    id: "mock-bottom-layer-stockings",
    displayName: "Bottom Layer (Stockings)",
    type: "bottom",
    brand: "Mock",
    size: "M",
    price: 0,
    currency: "USD",
    imageUrl: MOCK_BOTTOM_LAYER_IMAGE,
    description: "Mock stockings layer",
    color: "black",
    placement_y: 33,
    placement_x: 0,
    image_length: 98,
    layerZone: "bottom",
    layerRole: "inner",
    mannequinAssets: ["legs"],
    defaultEnabled: false,
  },
  {
    id: "mock-shoes-loafers",
    displayName: "Base Footwear",
    type: "shoes",
    brand: "Mock",
    size: "42",
    price: 0,
    currency: "USD",
    imageUrl: MOCK_SHOES_IMAGE,
    description: "Mock loafers",
    color: "brown",
    placement_y: 80,
    placement_x: 0,
    image_length: 18,
    layerZone: "shoes",
    layerRole: "base",
    mannequinAssets: ["feet"],
    defaultEnabled: true,
  },
  {
    id: "mock-shoes-layer-boots",
    displayName: "High Boot Layer",
    type: "shoes",
    brand: "Mock",
    size: "43",
    price: 0,
    currency: "USD",
    imageUrl: MOCK_SHOES_LAYER_IMAGE,
    description: "Mock chelsea boots",
    color: "black",
    placement_y: 78,
    placement_x: 0,
    image_length: 24,
    layerZone: "shoes",
    layerRole: "outer",
    mannequinAssets: ["feet"],
    defaultEnabled: false,
  },
];

