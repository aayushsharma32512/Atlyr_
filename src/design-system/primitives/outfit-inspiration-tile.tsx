import type { ComponentProps, CSSProperties, HTMLAttributes, Ref } from "react"

import { OutfitInspirationCard } from "@/features/studio/components/OutfitInspirationCard"
import { cn } from "@/lib/utils"

import {
  outfitInspirationPresets,
  type OutfitInspirationPresetKey,
} from "./outfit-inspiration-presets"

type OutfitInspirationCardProps = ComponentProps<typeof OutfitInspirationCard>

export type OutfitInspirationCardOverrides = Partial<
  Pick<
    OutfitInspirationCardProps,
    | "variant"
    | "showTitle"
    | "showChips"
    | "showSaveButton"
    | "sizeMode"
    | "aspectRatio"
    | "fluidLayout"
    | "renderBox"
    | "attribution"
  >
>

type WrapperProps = HTMLAttributes<HTMLDivElement>

type OutfitInspirationTileProps = Omit<OutfitInspirationCardProps, "className"> & {
  preset: OutfitInspirationPresetKey
  wrapperClassName?: string
  wrapperStyle?: CSSProperties
  wrapperProps?: WrapperProps
  wrapperRef?: Ref<HTMLDivElement>
  cardClassName?: string
  cardOverrides?: OutfitInspirationCardOverrides
  allowEmptyMannequin?: boolean
  onSlotSelect?: (slot: "top" | "bottom" | "shoes") => void
  /** Ref to the avatar container for snapshot capture */
  avatarRef?: Ref<HTMLDivElement>
}

export function OutfitInspirationTile({
  preset,
  wrapperClassName,
  wrapperStyle,
  wrapperProps,
  wrapperRef,
  cardClassName,
  cardOverrides,
  ...cardProps
}: OutfitInspirationTileProps) {
  const config = outfitInspirationPresets[preset]
  const { className: wrapperPropsClassName, style: wrapperPropsStyle, ...restWrapperProps } =
    wrapperProps ?? {}

  const resolvedAttribution =
    cardOverrides?.attribution ?? cardProps.attribution ?? config.defaultAttribution
  /* Merge all props */
  const mergedCardProps: OutfitInspirationCardProps = {
    ...config.cardDefaults,
    ...cardProps,
    ...cardOverrides,
    attribution: resolvedAttribution,
  }

  return (
    <div
      ref={wrapperRef}
      className={cn(config.wrapperClassName, wrapperClassName, wrapperPropsClassName)}
      style={{ ...wrapperStyle, ...wrapperPropsStyle }}
      {...restWrapperProps}
    >
      <OutfitInspirationCard
        {...mergedCardProps}
        className={cn(config.cardClassName, cardClassName)}
      />
    </div>
  )
}
