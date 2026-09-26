import { describe, expect, test } from "bun:test"

import { shouldDisablePostHogForLocation } from "@/integrations/posthog/posthogRoutePolicy"

const disabled = (hostname: string, pathname: string) =>
  shouldDisablePostHogForLocation({ hostname, pathname })

describe("posthog production gate", () => {
  test("captures on every production hostname", () => {
    for (const hostname of ["atlyr.app", "www.atlyr.app", "atlyr.in", "www.atlyr.in"]) {
      expect(disabled(hostname, "/collection")).toBe(false)
    }
  })

  test("blocks local and preview hostnames", () => {
    expect(disabled("localhost", "/collection")).toBe(true)
    expect(disabled("atlyr-git-feature-team.vercel.app", "/collection")).toBe(true)
  })

  test("captures the whole auth funnel, including the invite gate", () => {
    for (const pathname of ["/auth/login", "/auth/signup", "/auth/callback", "/auth/invite"]) {
      expect(disabled("atlyr.app", pathname)).toBe(false)
    }
  })

  test("blocks legacy, admin and unknown routes", () => {
    expect(disabled("atlyr.app", "/app/home")).toBe(true)
    expect(disabled("atlyr.app", "/admin/inventory")).toBe(true)
    expect(disabled("atlyr.app", "/nope")).toBe(true)
  })
})
