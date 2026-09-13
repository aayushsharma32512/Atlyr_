import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"

import type { ProductSearchFilters } from "@/services/search/searchService"

// searchService.ts imports the real supabase client module at the top, which would
// otherwise construct a client against the project's real (production) Supabase URL.
// Replace it before searchService is loaded so no test here can reach the network.
const invokeMock = mock(async (_name: string, _options: unknown) => ({ data: { results: [] }, error: null }))
const getSessionMock = mock(async () => ({ data: { session: null } }))
const fromMock = mock(() => {
  throw new Error("supabase.from should not be called by these tests")
})

mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invokeMock },
    auth: { getSession: getSessionMock },
    from: fromMock,
  },
}))

let searchService: typeof import("@/services/search/searchService").searchService
let buildSearchV3RequestBody: typeof import("@/services/search/searchService").buildSearchV3RequestBody

beforeAll(async () => {
  const mod = await import("@/services/search/searchService")
  searchService = mod.searchService
  buildSearchV3RequestBody = mod.buildSearchV3RequestBody
})

const ORIGINAL_FETCH = globalThis.fetch
const ENV_KEYS = ["DEV", "VITE_SEARCH_V3_URL", "VITE_SUPABASE_ANON_KEY"] as const
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]
  process.env.VITE_SUPABASE_ANON_KEY = "test-anon-key"
  invokeMock.mockClear()
  getSessionMock.mockClear()
  globalThis.fetch = ORIGINAL_FETCH
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  globalThis.fetch = ORIGINAL_FETCH
})

describe("buildSearchV3RequestBody", () => {
  it("builds the search-v3 request body from a searchProducts call", () => {
    const filters: ProductSearchFilters = { brands: ["Zara"] }

    const body = buildSearchV3RequestBody({
      query: "  red dress  ",
      imageUrl: "https://example.com/crop.jpg",
      productId: "prod-1",
      filters,
      gender: "female",
    })

    expect(body).toEqual({
      q: "red dress",
      imageUrl: "https://example.com/crop.jpg",
      productId: "prod-1",
      filters,
      gender: "female",
    })
  })

  it("omits empty fields instead of sending falsy values", () => {
    const body = buildSearchV3RequestBody({ query: "", gender: null })

    expect(body).toEqual({
      q: undefined,
      imageUrl: undefined,
      productId: undefined,
      filters: {},
      gender: undefined,
    })
  })
})

describe("searchService.searchProducts request routing", () => {
  it("posts directly to VITE_SEARCH_V3_URL when DEV and the dev URL are set", async () => {
    process.env.DEV = "true"
    process.env.VITE_SEARCH_V3_URL = "http://localhost:9999/search-v3"

    const fetchMock = mock(
      async () =>
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await searchService.searchProducts({ query: "boots", gender: "male" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).not.toHaveBeenCalled()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://localhost:9999/search-v3")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      apikey: "test-anon-key",
      Authorization: "Bearer test-anon-key",
    })
    expect(JSON.parse(init.body as string)).toEqual({ q: "boots", filters: {}, gender: "male" })
  })

  it("falls back to supabase.functions.invoke('search-v3', ...) when the dev URL is unset", async () => {
    process.env.DEV = "true"

    const fetchMock = mock(async () => {
      throw new Error("fetch should not be called when the dev URL is unset")
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await searchService.searchProducts({ query: "boots" })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith("search-v3", {
      body: { q: "boots", filters: {} },
    })
  })

  it("also uses supabase.functions.invoke when the dev URL is set but DEV is false", async () => {
    process.env.VITE_SEARCH_V3_URL = "http://localhost:9999/search-v3"

    const fetchMock = mock(async () => {
      throw new Error("fetch should not be called outside DEV")
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await searchService.searchProducts({ query: "boots" })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })
})
