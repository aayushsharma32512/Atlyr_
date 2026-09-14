import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

import { CUSTOM_FONT_SIZES, cn } from "../utils"

describe("cn", () => {
  it("keeps a custom size next to a colour", () => {
    expect(cn("text-card font-medium text-ink")).toBe("text-card font-medium text-ink")
    expect(cn("text-fluid-mark-landing text-foreground")).toBe("text-fluid-mark-landing text-foreground")
  })

  it("still resolves a real size conflict", () => {
    expect(cn("text-chip text-card")).toBe("text-card")
    expect(cn("text-ink text-taupe")).toBe("text-taupe")
  })

  it("knows every fontSize key in tailwind.config.ts", () => {
    const config = readFileSync(new URL("../../../tailwind.config.ts", import.meta.url), "utf8")
    const from = config.indexOf("\t\t\tfontSize: {")
    const block = config.slice(from, config.indexOf("\n\t\t\t},", from))
    const keys = [...block.matchAll(/^\t\t\t\t['"]?([A-Za-z0-9-]+)['"]?:/gm)].map((match) => match[1])
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(CUSTOM_FONT_SIZES).toContain(key)
  })
})
