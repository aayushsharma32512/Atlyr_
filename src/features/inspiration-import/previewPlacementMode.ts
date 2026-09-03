import type { StudioRenderedItem } from "@/features/studio/types"

type PlacementItem = Pick<StudioRenderedItem, "placement">

/**
 * Mirror the placement renderer's mannequin choice and use it only when every
 * visible garment can render on that body. Otherwise its internal filter would
 * silently drop the incompatible garment before loading its image.
 */
export function getImportAvatarPlacementMode(
  items: PlacementItem[],
  viewerGender: "male" | "female",
): "2d" | "3d" {
  if (!items.length) return "3d"
  const mannequin = items.some((item) => item.placement?.[viewerGender])
    ? viewerGender
    : items.find((item) => item.placement)?.placement?.male
      ? "male"
      : items.some((item) => item.placement?.female)
        ? "female"
        : viewerGender

  return items.every((item) => Boolean(item.placement?.[mannequin])) ? "3d" : "2d"
}
