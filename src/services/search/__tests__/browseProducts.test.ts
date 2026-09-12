import { beforeEach, describe, expect, it, mock } from "bun:test"

// Records the builder chain so the test can assert filters, order and range.
const calls: Array<[string, unknown[]]> = []
let rows: Record<string, unknown>[] = []
let failWith: { message: string } | null = null

function builder() {
  const chain: Record<string, unknown> = {}
  const step = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return chain
  }
  for (const name of ["select", "eq", "not", "or", "order"]) chain[name] = step(name)
  chain.range = (...args: unknown[]) => {
    calls.push(["range", args])
    return Promise.resolve(failWith ? { data: null, error: failWith } : { data: rows, error: null })
  }
  return chain
}

mock.module("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => { calls.push(["from", [table]]); return builder() } },
}))

const { browseProducts, BROWSE_PRODUCTS_PAGE } = await import("../searchService")

const row = (id: string) => ({ id, product_name: `P ${id}`, brand: "B", price: 1, currency: "INR", image_url: `u/${id}`, thumbnail_url: null, type: "top" })

beforeEach(() => {
  calls.length = 0
  rows = []
  failWith = null
})

describe("browseProducts", () => {
  it("filters by slot type and profile gender, newest first, one page", async () => {
    rows = [row("a"), row("b")]
    const page = await browseProducts({ slot: "top", gender: "female", cursor: 0 })
    expect(page.results.map((r) => r.id)).toEqual(["a", "b"])
    expect(page.nextCursor).toBeNull() // short page = end
    expect(calls).toContainEqual(["from", ["products"]])
    expect(calls).toContainEqual(["eq", ["type", "top"]])
    expect(calls).toContainEqual(["not", ["image_url", "is", null]])
    expect(calls).toContainEqual(["or", ["gender.eq.unisex,gender.eq.female,gender.is.null"]])
    expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]])
    expect(calls).toContainEqual(["range", [0, BROWSE_PRODUCTS_PAGE - 1]])
  })

  it("advances the cursor on a full page and skips the gender filter without a profile gender", async () => {
    rows = Array.from({ length: BROWSE_PRODUCTS_PAGE }, (_, i) => row(`r${i}`))
    const page = await browseProducts({ slot: "shoes", gender: null, cursor: 48 })
    expect(page.nextCursor).toBe(48 + BROWSE_PRODUCTS_PAGE)
    expect(calls).toContainEqual(["range", [48, 48 + BROWSE_PRODUCTS_PAGE - 1]])
    expect(calls.some(([name]) => name === "or")).toBe(false)
  })

  it("throws the Supabase message", async () => {
    failWith = { message: "boom" }
    await expect(browseProducts({ slot: "bottom", gender: "male", cursor: 0 })).rejects.toThrow("boom")
  })
})
