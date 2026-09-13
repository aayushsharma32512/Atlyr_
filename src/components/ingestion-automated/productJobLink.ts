/**
 * Reaching a pipeline job from a catalog product.
 *
 * `products.id` is a deterministic sha1 of the job id — see catalogId() in
 * services/ingestion-automated/src/domain/catalog.ts. Hashing job ids lets us map job → product
 * WITHOUT relying on `ingested_product_id`, which is only written on the publish path, so a job
 * that was staged but never published would otherwise join to nothing.
 *
 * Pure and framework-free so the linking rule can be tested on its own: it is the part that fails
 * silently — an unlinked product just shows no controls, which looks identical to a product that
 * legitimately has no job behind it.
 */

/** The two columns any job row needs for linking; callers select whatever else they want beside them. */
export type JobLinkRow = {
  job_id: string
  ingested_product_id: string | null
}

/** crypto.subtle needs a secure context; localhost and https both qualify. */
export async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Index job rows by the product id they belong to, keeping only products the caller asked for.
 *
 * The FK is tried first because it needs no hashing; the derived id then covers everything the FK
 * misses. A product already claimed by the FK is never overwritten by a hash match, and the first
 * job to claim a product wins — later duplicates are ignored rather than silently replacing it.
 */
export async function resolveByProductId<T extends JobLinkRow>(
  rows: readonly T[],
  wantedProductIds: ReadonlySet<string>,
): Promise<Record<string, T>> {
  const out: Record<string, T> = {}

  for (const row of rows) {
    const fk = row.ingested_product_id
    if (fk && wantedProductIds.has(fk) && !out[fk]) out[fk] = row
  }

  // Only hash what the FK could not place — sha1 over every row would be wasted work on a big queue.
  const unplaced = rows.filter(r => !r.ingested_product_id || !out[r.ingested_product_id])
  const hashed = await Promise.all(unplaced.map(async r => [await sha1Hex(r.job_id), r] as const))
  for (const [productId, row] of hashed) {
    if (wantedProductIds.has(productId) && !out[productId]) out[productId] = row
  }

  return out
}
