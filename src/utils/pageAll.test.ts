import { describe, expect, test } from "bun:test"
import { pageAll, POSTGREST_PAGE_SIZE } from "./pageAll"

/** A fake table of N rows answering inclusive ranges the way PostgREST does — silently capped. */
function table(n: number, cap = POSTGREST_PAGE_SIZE) {
  const all = Array.from({ length: n }, (_v, i) => i)
  const calls: Array<[number, number]> = []
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to])
    const end = Math.min(to, from + cap - 1)
    return all.slice(from, end + 1)
  }
  return { fetchPage, calls }
}

describe("pageAll — reading past PostgREST's silent row cap", () => {
  test("one short page, one request", async () => {
    const t = table(42)
    expect((await pageAll(t.fetchPage)).length).toBe(42)
    expect(t.calls.length).toBe(1)
  })

  // The regression: 1444 products, a 1000-row cap, and no error to say 444 are missing.
  test("1444 rows behind a 1000-row cap come back whole", async () => {
    const t = table(1444)
    const rows = await pageAll(t.fetchPage)
    expect(rows.length).toBe(1444)
    expect(rows[1443]).toBe(1443)
  })

  test("an exact multiple of the page size terminates", async () => {
    const t = table(2000)
    expect((await pageAll(t.fetchPage)).length).toBe(2000)
    expect(t.calls.length).toBe(3) // 1000, 1000, then an empty page proves the end
  })

  test("an empty table is one request and no rows", async () => {
    const t = table(0)
    expect(await pageAll(t.fetchPage)).toEqual([])
    expect(t.calls.length).toBe(1)
  })

  test("ranges are contiguous and inclusive — no row skipped between pages", async () => {
    const t = table(2500)
    await pageAll(t.fetchPage)
    expect(t.calls[0]).toEqual([0, 999])
    expect(t.calls[1]).toEqual([1000, 1999])
    expect(t.calls[2]).toEqual([2000, 2999])
  })

  // A server that never returns a short page must not loop forever.
  test("maxPages bounds a server that always answers full", async () => {
    let calls = 0
    const never = async (from: number, to: number) => {
      calls += 1
      return Array.from({ length: to - from + 1 }, (_v, i) => from + i)
    }
    expect((await pageAll(never, { pageSize: 10, maxPages: 5 })).length).toBe(50)
    expect(calls).toBe(5)
  })

  test("an error from the page fetch propagates rather than truncating silently", async () => {
    const boom = async () => { throw new Error("Bad Request") }
    await expect(pageAll(boom)).rejects.toThrow("Bad Request")
  })
})
