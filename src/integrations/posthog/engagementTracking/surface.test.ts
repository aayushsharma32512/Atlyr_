import { describe, expect, test } from "bun:test"

import { isPostHogAllowedPath } from "@/integrations/posthog/posthogRoutePolicy"
import { computeSurfaceContext } from "@/integrations/posthog/engagementTracking/surface"

describe("inspiration import engagement surface", () => {
  test("maps both the entry route and import detail routes", () => {
    const base = { search: "", isReturningDevice: false, referrer: "" }

    expect(computeSurfaceContext({ ...base, pathname: "/inspiration-import" }).surface)
      .toBe("inspiration_import")
    expect(computeSurfaceContext({ ...base, pathname: "/inspiration-import/import-1" }).surface)
      .toBe("inspiration_import")
  })

  test("allows the inspiration route through the production route gate", () => {
    expect(isPostHogAllowedPath("/inspiration-import/import-1")).toBe(true)
  })
})

describe("board detail engagement surface", () => {
  const base = { search: "", isReturningDevice: false, referrer: "" }

  test("board detail keeps the home_moodboard surface on its new path", () => {
    const ctx = computeSurfaceContext({ ...base, pathname: "/collection/board/favorites" })
    expect(ctx.surface).toBe("home_moodboard")
    expect(ctx.props.moodboard_slug).toBe("favorites")
  })

  test("slug is decoded, and the generations alias still canonicalizes", () => {
    expect(
      computeSurfaceContext({ ...base, pathname: "/collection/board/office%20wear" }).props.moodboard_slug,
    ).toBe("office wear")
    expect(
      computeSurfaceContext({ ...base, pathname: "/collection/board/generations" }).props.moodboard_slug,
    ).toBe("try-ons")
  })

  test("the collections tabs are unaffected by the board prefix", () => {
    expect(computeSurfaceContext({ ...base, pathname: "/collection" }).surface)
      .toBe("collections_moodboards")
    expect(computeSurfaceContext({ ...base, pathname: "/collection", search: "?tab=creations" }).surface)
      .toBe("collections_creations")
  })

  test("old /home links still resolve while the redirect is in place", () => {
    expect(
      computeSurfaceContext({ ...base, pathname: "/home", search: "?moodboard=favorites" }).surface,
    ).toBe("home_moodboard")
    expect(computeSurfaceContext({ ...base, pathname: "/home" }).surface).toBe("home_feed")
  })

  test("board detail passes the production route gate", () => {
    expect(isPostHogAllowedPath("/collection/board/favorites")).toBe(true)
  })
})
