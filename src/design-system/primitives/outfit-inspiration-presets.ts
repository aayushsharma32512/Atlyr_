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
  framed?: boolean
  /**
   * Only the full-figure presets (hero, heroCanonical) pay for the 2K texture
   * upgrade; grid and cover tiles stop at the webp, which is all they can show.
   */
  textureQuality?: "progressive" | "thumbnail"
  /** Vertical nudge of the figure in card px; negative lifts it. */
  avatarOffsetY?: number
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
    wrapperClassName: "",
    cardDefaults: {
      textureQuality: "thumbnail",
      variant: "narrow",
      showTitle: true,
      showChips: true,
      showSaveButton: true,
      sizeMode: "fluid",
      fluidLayout: "avatar",
      aspectRatio: "3 / 4",
      renderBox: CANONICAL_HERO_RENDER_BOX,
      framed: true,
    },
  },
  homeCurated: {
    wrapperClassName: "",
    cardDefaults: {
      textureQuality: "thumbnail",
      // Lifts the figure off the footer. Every surface on this preset is the
      // same outfit card, so the nudge lives here rather than per call site.
      avatarOffsetY: -12,
      variant: "narrow",
      showTitle: true,
      showChips: true,
      showSaveButton: true,
      sizeMode: "fluid",
      fluidLayout: "avatar",
      aspectRatio: "3 / 4",
      renderBox: CANONICAL_HERO_RENDER_BOX,
      framed: true,
    },
  },
  rail: {
    wrapperClassName: "rounded-sm bg-white py-2",
    cardDefaults: {
      textureQuality: "thumbnail",
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
      textureQuality: "thumbnail",
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
      textureQuality: "thumbnail",
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
