import { CANONICAL_HERO_RENDER_BOX } from "@/features/studio/constants/renderBox"

export type OutfitInspirationPresetKey =
  | "hero"
  | "heroCanonical"
  | "gridMeta"
  | "homeCurated"
  | "rail"
  | "compact"
  | "moodboardPreview"

export type OutfitInspirationCardDefaults = {
  variant?: "wide" | "narrow"
  showTitle?: boolean
  showChips?: boolean
  showSaveButton?: boolean
  sizeMode?: "fixed" | "fluid"
  aspectRatio?: string
  fluidLayout?: "card" | "avatar"
  renderBox?: { width: number; height: number }
}

export type OutfitInspirationPresetConfig = {
  wrapperClassName: string
  cardDefaults: OutfitInspirationCardDefaults
  defaultAttribution?: string
  cardClassName?: string
}

export const outfitInspirationPresets: Record<
  OutfitInspirationPresetKey,
  OutfitInspirationPresetConfig
> = {
  hero: {
    wrapperClassName: "h-full w-full",
    cardDefaults: {
      variant: "narrow",
      showTitle: false,
      showChips: false,
      showSaveButton: false,
      sizeMode: "fluid",
      fluidLayout: "card",
      aspectRatio: "3 / 4",
    },
  },
  heroCanonical: {
    wrapperClassName: "h-full w-full",
    cardDefaults: {
      variant: "narrow",
      showTitle: false,
      showChips: false,
      showSaveButton: false,
      sizeMode: "fluid",
      fluidLayout: "card",
      aspectRatio: "3 / 4",
      renderBox: CANONICAL_HERO_RENDER_BOX,
    },
  },
  gridMeta: {
    wrapperClassName: "rounded-sm bg-white px-1 py-1",
    cardDefaults: {
      variant: "narrow",
      showTitle: true,
      showChips: true,
      showSaveButton: true,
      sizeMode: "fluid",
      fluidLayout: "avatar",
      aspectRatio: "3 / 4",
      renderBox: CANONICAL_HERO_RENDER_BOX,
    },
  },
  homeCurated: {
    wrapperClassName: "rounded-2xl p-0.5",
    cardDefaults: {
      variant: "narrow",
      showTitle: true,
      showChips: true,
      showSaveButton: true,
      sizeMode: "fluid",
      fluidLayout: "avatar",
      aspectRatio: "3 / 4",
      renderBox: CANONICAL_HERO_RENDER_BOX,
    },
  },
  rail: {
    wrapperClassName: "rounded-sm bg-white py-2",
    cardDefaults: {
      variant: "narrow",
      showTitle: false,
      showChips: false,
      showSaveButton: true,
      sizeMode: "fluid",
      fluidLayout: "avatar",
      aspectRatio: "3 / 4",
      renderBox: CANONICAL_HERO_RENDER_BOX,
    },
  },
  compact: {
    wrapperClassName: "rounded-sm p-1",
    cardDefaults: {
      variant: "narrow",
      showTitle: false,
      showChips: false,
      showSaveButton: true,
      sizeMode: "fixed",
      // fluidLayout: "avatar",
      aspectRatio: "3 / 4",
      renderBox: CANONICAL_HERO_RENDER_BOX,
    },
  },
  moodboardPreview: {
    wrapperClassName: "rounded-sm bg-white p-1",
    cardDefaults: {
      variant: "narrow",
      showTitle: false,
      showChips: false,
      showSaveButton: false,
      sizeMode: "fluid",
      fluidLayout: "card",
      aspectRatio: "7 / 9",
      renderBox: CANONICAL_HERO_RENDER_BOX,
    },
  },
}
