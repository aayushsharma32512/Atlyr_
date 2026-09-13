import { beforeEach, describe, expect, test } from "bun:test"
import {
  DEFAULT_STENCIL_OPACITY,
  STENCIL_OPACITY_MAX,
  STENCIL_OPACITY_MIN,
  clampStencilOpacity,
  readStencilOpacity,
  writeStencilOpacity,
  STENCIL_OPACITY_KEY,
} from "./stencilOpacity"

/** Minimal localStorage stand-in; `mode` reproduces the two ways a real one refuses to work. */
function fakeStorage(mode: "ok" | "throws-on-read" | "throws-on-write" = "ok") {
  const data = new Map<string, string>()
  return {
    store: {
      getItem: (k: string) => {
        if (mode === "throws-on-read") throw new Error("SecurityError")
        return data.get(k) ?? null
      },
      setItem: (k: string, v: string) => {
        if (mode === "throws-on-write") throw new Error("QuotaExceededError")
        data.set(k, v)
      },
    } as unknown as Storage,
    data,
  }
}

describe("clampStencilOpacity", () => {
  test("keeps a sensible value untouched", () => {
    expect(clampStencilOpacity(0.2)).toBe(0.2)
  })

  test("clamps to the ends rather than rejecting", () => {
    expect(clampStencilOpacity(-1)).toBe(STENCIL_OPACITY_MIN)
    expect(clampStencilOpacity(5)).toBe(STENCIL_OPACITY_MAX)
  })

  // A stored value that is not a number must not make the ghost vanish or go opaque.
  test("garbage falls back to the default", () => {
    expect(clampStencilOpacity(Number.NaN)).toBe(DEFAULT_STENCIL_OPACITY)
    expect(clampStencilOpacity(Number.POSITIVE_INFINITY)).toBe(DEFAULT_STENCIL_OPACITY)
  })

  test("0 is allowed — it is the same as switching the ghost off", () => {
    expect(clampStencilOpacity(0)).toBe(0)
  })
})

describe("readStencilOpacity", () => {
  let fake: ReturnType<typeof fakeStorage>
  beforeEach(() => { fake = fakeStorage() })

  test("returns the default when nothing is stored", () => {
    expect(readStencilOpacity(fake.store)).toBe(DEFAULT_STENCIL_OPACITY)
  })

  test("round-trips a written value", () => {
    writeStencilOpacity(0.3, fake.store)
    expect(readStencilOpacity(fake.store)).toBe(0.3)
  })

  test("an out-of-range stored value is clamped on the way out", () => {
    fake.data.set(STENCIL_OPACITY_KEY, "0.9")
    expect(readStencilOpacity(fake.store)).toBe(STENCIL_OPACITY_MAX)
  })

  test("a non-numeric stored value falls back to the default", () => {
    fake.data.set(STENCIL_OPACITY_KEY, "quite faint please")
    expect(readStencilOpacity(fake.store)).toBe(DEFAULT_STENCIL_OPACITY)
  })

  // Private windows and blocked site data throw on access rather than returning null.
  test("a storage that throws on read still yields the default", () => {
    expect(readStencilOpacity(fakeStorage("throws-on-read").store)).toBe(DEFAULT_STENCIL_OPACITY)
  })

  test("a storage that throws on write does not blow up the caller", () => {
    expect(() => writeStencilOpacity(0.2, fakeStorage("throws-on-write").store)).not.toThrow()
  })

  test("absent storage (SSR, no window) is not an error", () => {
    expect(readStencilOpacity(null)).toBe(DEFAULT_STENCIL_OPACITY)
    expect(() => writeStencilOpacity(0.2, null)).not.toThrow()
  })
})
