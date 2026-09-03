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
