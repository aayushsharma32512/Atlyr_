import { beforeEach, describe, expect, it, mock } from "bun:test"

// A tiny in-memory stand-in for the two query shapes the service uses.
type Row = { slug: string; path: string }
const rows: Row[] = []
const calls: string[] = []
let failInsertsWith: { code: string; message: string } | null = null
let missNextLookup = false

function select(column: "slug" | "path") {
  return {
    eq: (key: "slug" | "path", value: string) => ({
      maybeSingle: async () => {
        calls.push(`select ${column} by ${key}`)
        if (missNextLookup) {
          missNextLookup = false
          return { data: null, error: null }
        }
        const row = rows.find((r) => r[key] === value)
        return { data: row ? { [column]: row[column] } : null, error: null }
      },
    }),
  }
}

mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select,
      insert: async (row: Row) => {
        calls.push("insert")
        if (failInsertsWith) return { error: failInsertsWith }
        if (rows.some((r) => r.slug === row.slug || r.path === row.path)) {
          return { error: { code: "23505", message: "duplicate key" } }
        }
        rows.push({ slug: row.slug, path: row.path })
        return { error: null }
      },
    }),
  },
}))

const { createShareLink, resolveShareLink } = await import("../shareLinksService")

beforeEach(() => {
  rows.length = 0
  calls.length = 0
  failInsertsWith = null
  missNextLookup = false
})

describe("createShareLink", () => {
  it("mints a slug for a new path and resolves it back", async () => {
    const slug = await createShareLink("/studio?outfitId=a&share=1", "user-1")
    expect(slug).toHaveLength(8)
    expect(await resolveShareLink(slug)).toBe("/studio?outfitId=a&share=1")
  })

  it("returns the existing slug for a path already shared, without inserting", async () => {
    const first = await createShareLink("/studio?outfitId=a&share=1", "user-1")
    calls.length = 0
    const second = await createShareLink("/studio?outfitId=a&share=1", "user-2")
    expect(second).toBe(first)
    expect(calls).toEqual(["select slug by path"])
  })

  it("reuses the slug when a concurrent mint of the same path wins the race", async () => {
    // The first lookup misses, the insert then clashes on path, the re-read finds the winner.
    rows.push({ slug: "racedone", path: "/studio?outfitId=b" })
    missNextLookup = true
    expect(await createShareLink("/studio?outfitId=b", null)).toBe("racedone")
    expect(calls).toEqual(["select slug by path", "insert", "select slug by path"])
  })

  it("gives up on non-unique errors", async () => {
    failInsertsWith = { code: "42501", message: "permission denied" }
    await expect(createShareLink("/studio?outfitId=c", null)).rejects.toThrow()
    expect(calls.filter((c) => c === "insert")).toHaveLength(1)
  })

  it("refuses a path that could leave the app", async () => {
    await expect(createShareLink("https://evil.example/x", "user-1")).rejects.toThrow()
    expect(calls).toEqual([])
  })
})
