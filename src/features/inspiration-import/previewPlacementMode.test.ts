import { describe, expect, test } from "bun:test"
import type { StudioPlacementByMannequin } from "@/features/studio/types"
import { getImportAvatarPlacementMode } from "./previewPlacementMode"

const transform = (mannequin: "male" | "female") => ({
  scale: 1,
  rotationDeg: 0,
  tx: 0,
  ty: 0,
  warp: [],
  mannequin,
})

const placement = (...mannequins: Array<"male" | "female">): StudioPlacementByMannequin => (
  Object.fromEntries(mannequins.map((mannequin) => [mannequin, transform(mannequin)]))
)

describe("getImportAvatarPlacementMode", () => {
  test("keeps the 3D mannequin when there is no garment", () => {
    expect(getImportAvatarPlacementMode([], "female")).toBe("3d")
  })

  test("uses 3D for a garment placed on the viewer mannequin", () => {
    expect(getImportAvatarPlacementMode([{ placement: placement("female") }], "female")).toBe("3d")
  })

  test("uses the placement renderer's other-gender fallback for a single garment", () => {
    expect(getImportAvatarPlacementMode([{ placement: placement("male") }], "female")).toBe("3d")
  })

  test("falls back to 2D when a selected garment has no 3D placement", () => {
    expect(getImportAvatarPlacementMode([{ placement: null }], "female")).toBe("2d")
  })

  test("keeps 3D when every selected garment supports its chosen mannequin", () => {
    expect(getImportAvatarPlacementMode([
      { placement: placement("female") },
      { placement: placement("female", "male") },
    ], "female")).toBe("3d")
  })

  test("falls back to 2D instead of dropping an incompatible top or bottom", () => {
    expect(getImportAvatarPlacementMode([
      { placement: placement("female") },
      { placement: placement("male") },
    ], "female")).toBe("2d")
  })
})
