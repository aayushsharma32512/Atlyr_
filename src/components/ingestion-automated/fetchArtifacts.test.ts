import { describe, expect, test } from "bun:test"
import {
  fetchArtifacts,
  fetchInChunks,
  ARTIFACT_CHUNK_SIZE,
  ARTIFACT_PAGE_SIZE,
  type ArtifactClient,
} from "./fetchArtifacts"

type Row = { job_id: string; data: Record<string, unknown> | null }

/**
 * Minimal stand-in for the PostgREST builder. Records every request so the tests can assert on
 * chunk boundaries and paging, and reproduces the two behaviours that broke the dashboard:
 * a 400 above `urlLimit` ids, and a hard cap of `pageCap` rows per response.
 */
function fakeClient(opts: { rows: Row[]; urlLimit?: number; pageCap?: number }) {
  const requests: { table: string; idColumn: string; ids: string[]; from: number; to: number }[] = []
  const pageCap = opts.pageCap ?? ARTIFACT_PAGE_SIZE

  const client = {
    from(table: string) {
      let ids: string[] = []
      let idColumn = ""
      let from = 0
      let to = pageCap - 1
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        in: (col: string, value: string[]) => {
          if (col !== "artifact_type") { ids = value; idColumn = col }
          return builder
        },
        range: (a: number, b: number) => { from = a; to = b; return builder },
        then: (resolve: (r: { data: Row[] | null; error: { message: string } | null }) => unknown) => {
          requests.push({ table, idColumn, ids, from, to })
          if (opts.urlLimit && ids.length > opts.urlLimit) {
            return Promise.resolve({ data: null, error: { message: "Bad Request" } }).then(resolve)
          }
          const matching = opts.rows.filter(r => ids.includes(r.job_id))
          const page = matching.slice(from, Math.min(to + 1, from + pageCap))
          return Promise.resolve({ data: page, error: null }).then(resolve)
        },
      }
      return builder
    },
  }
  return { client: client as unknown as ArtifactClient, requests }
}

const rowsFor = (jobIds: string[], perJob: number): Row[] =>
  jobIds.flatMap(id => Array.from({ length: perJob }, (_, i) => ({ job_id: id, data: { i } })))

const jobIds = (n: number) => Array.from({ length: n }, (_, i) => `job-${String(i).padStart(4, "0")}`)

describe("fetchArtifacts", () => {
  test("returns every row when the id list is far past the URL-length cliff", async () => {
    const ids = jobIds(854)
    const rows = rowsFor(ids, 2)
    // 644 ids is where the real endpoint starts returning 400.
    const { client } = fakeClient({ rows, urlLimit: 643 })

    const out = await fetchArtifacts(client, { jobIds: ids, artifactTypes: "enrichment" })

    expect(out).toHaveLength(rows.length)
    expect(new Set(out.map(r => r.job_id)).size).toBe(854)
  })

  test("never sends more than the chunk size of ids in one request", async () => {
    const ids = jobIds(854)
    const { client, requests } = fakeClient({ rows: rowsFor(ids, 2), urlLimit: 643 })

    await fetchArtifacts(client, { jobIds: ids, artifactTypes: "enrichment" })

    expect(requests.length).toBeGreaterThan(1)
    for (const req of requests) expect(req.ids.length).toBeLessThanOrEqual(ARTIFACT_CHUNK_SIZE)
  })

  test("pages past the 1000-row response cap instead of truncating", async () => {
    // One chunk's worth of ids, but enough artifacts each to blow past a single page.
    const ids = jobIds(ARTIFACT_CHUNK_SIZE)
    const rows = rowsFor(ids, 12) // 12 * chunk size, well over one page
    const { client } = fakeClient({ rows, pageCap: 1000 })

    const out = await fetchArtifacts(client, { jobIds: ids, artifactTypes: "enrichment" })

    expect(out).toHaveLength(rows.length)
  })

  test("throws instead of silently returning nothing when a request fails", async () => {
    const ids = jobIds(10)
    const { client } = fakeClient({ rows: rowsFor(ids, 1), urlLimit: 5 })

    await expect(
      fetchArtifacts(client, { jobIds: ids, artifactTypes: "enrichment", chunkSize: 10 }),
    ).rejects.toThrow("Bad Request")
  })

  test("keeps rows in id order across chunks, so last-write-wins still picks the newest", async () => {
    // Every caller does `next[row.job_id] = ...` while walking the result, relying on the rows for
    // a job arriving oldest-first. Chunks must not be allowed to interleave or land out of order.
    const ids = jobIds(ARTIFACT_CHUNK_SIZE * 3)
    const rows = ids.flatMap(id => [
      { job_id: id, data: { seq: 0 } },
      { job_id: id, data: { seq: 1 } },
    ])
    const { client } = fakeClient({ rows, urlLimit: 643 })

    const out = await fetchArtifacts(client, { jobIds: ids, artifactTypes: "enrichment" })

    expect(out.map(r => r.job_id)).toEqual(rows.map(r => r.job_id))
    const last: Record<string, number> = {}
    for (const row of out) last[row.job_id] = (row.data as { seq: number }).seq
    expect(Object.values(last).every(v => v === 1)).toBe(true)
  })

  test("makes no request at all for an empty job list", async () => {
    const { client, requests } = fakeClient({ rows: [] })

    const out = await fetchArtifacts(client, { jobIds: [], artifactTypes: "enrichment" })

    expect(out).toEqual([])
    expect(requests).toHaveLength(0)
  })
})

describe("fetchInChunks", () => {
  test("chunks a non-artifact table by its own id column", async () => {
    const ids = jobIds(400)
    const rows = ids.map(id => ({ job_id: id, data: null }))
    const { client, requests } = fakeClient({ rows, urlLimit: 643 })

    const out = await fetchInChunks(client, {
      table: "ingested_products",
      idColumn: "pipeline_job_id",
      ids,
      columns: "pipeline_job_id, verdict",
    })

    expect(out).toHaveLength(400)
    expect(requests.every(r => r.table === "ingested_products")).toBe(true)
    expect(requests.every(r => r.idColumn === "pipeline_job_id")).toBe(true)
    expect(requests.every(r => r.ids.length <= ARTIFACT_CHUNK_SIZE)).toBe(true)
  })
})
