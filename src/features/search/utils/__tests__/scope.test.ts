import { describe, expect, it } from "bun:test"

import {
  SEARCH_SCOPES,
  isSearchScope,
  resolveScope,
  scopeToMode,
  scopeToSlot,
  slotToScope,
} from "../scope"

describe("scope", () => {
  it("lists the four scopes in whiteboard order", () => {
    expect(SEARCH_SCOPES).toEqual(["looks", "tops", "lowers", "kicks"])
  })

  it("maps scopes to tray slots and back", () => {
    expect(scopeToSlot("looks")).toBeNull()
    expect(scopeToSlot("tops")).toBe("top")
    expect(scopeToSlot("lowers")).toBe("bottom")
    expect(scopeToSlot("kicks")).toBe("shoes")
    expect(slotToScope("bottom")).toBe("lowers")
  })

  it("maps scopes to the legacy search mode", () => {
    expect(scopeToMode("looks")).toBe("outfits")
    expect(scopeToMode("kicks")).toBe("products")
  })

  it("resolves scope from the URL, falling back to mode, then looks", () => {
    expect(resolveScope(new URLSearchParams("scope=lowers"))).toBe("lowers")
    expect(resolveScope(new URLSearchParams("mode=products"))).toBe("tops")
    expect(resolveScope(new URLSearchParams("mode=outfits"))).toBe("looks")
    expect(resolveScope(new URLSearchParams("scope=junk&mode=products"))).toBe("tops")
    expect(resolveScope(new URLSearchParams(""))).toBe("looks")
    expect(isSearchScope("kicks")).toBe(true)
    expect(isSearchScope("shoes")).toBe(false)
  })
})
