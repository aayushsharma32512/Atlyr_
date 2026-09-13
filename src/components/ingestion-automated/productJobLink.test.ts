import { describe, expect, test } from "bun:test"
import { resolveByProductId, sha1Hex, type JobLinkRow } from "./productJobLink"

// products.id is sha1(job_id) — see catalogId() in services/ingestion-automated/src/domain/catalog.ts.
const JOB_A = "11111111-1111-4111-8111-111111111111"
const JOB_B = "22222222-2222-4222-8222-222222222222"

describe("resolveByProductId — reaching a pipeline job from a catalog product", () => {
  test("uses ingested_product_id when the publish path set it", async () => {
    const rows: JobLinkRow[] = [{ job_id: JOB_A, ingested_product_id: "prod-a" }]
    expect(await resolveByProductId(rows, new Set(["prod-a"]))).toEqual({ "prod-a": rows[0] })
  })

  // The case the FK misses: a job staged but never published has no ingested_product_id, yet the
  // product row exists with the derived id. Without this the eraser button would never appear.
  test("falls back to sha1(job_id) for a job that was never published", async () => {
    const derived = await sha1Hex(JOB_A)
    const rows: JobLinkRow[] = [{ job_id: JOB_A, ingested_product_id: null }]
    expect(await resolveByProductId(rows, new Set([derived]))).toEqual({ [derived]: rows[0] })
  })

  test("the FK wins over the derived id when both point somewhere wanted", async () => {
    const derived = await sha1Hex(JOB_A)
    const rows: JobLinkRow[] = [{ job_id: JOB_A, ingested_product_id: "prod-a" }]
    const out = await resolveByProductId(rows, new Set(["prod-a", derived]))
    expect(out["prod-a"]).toBe(rows[0])
    expect(out[derived]).toBeUndefined()
  })

  test("products nobody asked for are not returned", async () => {
    const rows: JobLinkRow[] = [{ job_id: JOB_A, ingested_product_id: "prod-a" }]
    expect(await resolveByProductId(rows, new Set(["prod-z"]))).toEqual({})
  })

  test("a product with no job behind it simply has no entry", async () => {
    expect(await resolveByProductId([], new Set(["legacy-import"]))).toEqual({})
  })

  test("first job wins when two would claim the same product", async () => {
    const rows: JobLinkRow[] = [
      { job_id: JOB_A, ingested_product_id: "prod-a" },
      { job_id: JOB_B, ingested_product_id: "prod-a" },
    ]
    expect((await resolveByProductId(rows, new Set(["prod-a"])))["prod-a"]).toBe(rows[0])
  })

  test("sha1Hex is the 40-char hex the catalog id is built from", async () => {
    const h = await sha1Hex(JOB_A)
    expect(h).toMatch(/^[0-9a-f]{40}$/)
    expect(await sha1Hex(JOB_A)).toBe(h)
    expect(await sha1Hex(JOB_B)).not.toBe(h)
  })
})
