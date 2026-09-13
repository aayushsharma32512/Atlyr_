import { describe, expect, it } from "bun:test"

import {
  SCOPE_LABELS,
  SEARCH_SCOPES,
  isSearchScope,
  resolveScope,
  scopeToMode,
  scopeToSlot,
  slotToScope,
} from "../scope"

describe("scope", () => {
  it("lists the three scopes in rail order, outfits first", () => {
    expect(SEARCH_SCOPES).toEqual(["looks", "tops", "lowers"])
    expect(SCOPE_LABELS.looks).toBe("Outfits")
  })

  it("maps scopes to tray slots and back", () => {
    expect(scopeToSlot("looks")).toBeNull()
    expect(scopeToSlot("tops")).toBe("top")
    expect(scopeToSlot("lowers")).toBe("bottom")
    expect(slotToScope("bottom")).toBe("lowers")
    expect(slotToScope("shoes")).toBeNull()
  })

  it("maps scopes to the legacy search mode", () => {
    expect(scopeToMode("looks")).toBe("outfits")
    expect(scopeToMode("lowers")).toBe("products")
  })

  it("resolves scope from the URL, falling back to mode, then looks", () => {
    expect(resolveScope(new URLSearchParams("scope=lowers"))).toBe("lowers")
    expect(resolveScope(new URLSearchParams("mode=products"))).toBe("tops")
    expect(resolveScope(new URLSearchParams("mode=outfits"))).toBe("looks")
    expect(resolveScope(new URLSearchParams("scope=kicks&mode=products"))).toBe("tops")
    expect(resolveScope(new URLSearchParams(""))).toBe("looks")
    expect(isSearchScope("lowers")).toBe(true)
    expect(isSearchScope("kicks")).toBe(false)
  })
})
