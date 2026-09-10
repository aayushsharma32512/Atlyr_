/**
 * Batched reads from `pipeline_step_artifacts` for a page of jobs.
 *
 * Every dashboard hook needs the same thing: "give me these artifact types for these job ids".
 * Doing that as one `.in('job_id', ids)` breaks twice once the queue gets big, and both failures
 * are silent — which is what made a fully-enriched batch render as a grid of em-dashes:
 *
 *  · Above ~643 ids the query string passes ~24KB and the endpoint answers 400. Hooks that did
 *    `if (error) return` left their map empty, so every field showed "—".
 *  · Even under that cliff PostgREST caps a response at 1000 rows. Rows come back ordered by
 *    created_at ascending, so the newest artifacts are the ones that fall off the end.
 *
 * Chunking the ids fixes the first and paging fixes the second. Chunking by job id (rather than by
 * row) also keeps every artifact for a given job inside one chunk, so the ascending order each
 * caller relies on for last-write-wins still holds per job.
 */

/** Ids per request. ~24KB of query string is the observed cliff; 150 leaves generous headroom. */
export const ARTIFACT_CHUNK_SIZE = 150
/** PostgREST's default response cap. A full page means "there may be more". */
export const ARTIFACT_PAGE_SIZE = 1000

const TABLE = 'pipeline_step_artifacts'

export type ArtifactRow = { job_id: string } & Record<string, unknown>

type ArtifactResult = { data: ArtifactRow[] | null; error: { message: string } | null }

export interface ArtifactQuery extends PromiseLike<ArtifactResult> {
  select(columns: string): ArtifactQuery
  in(column: string, values: readonly string[]): ArtifactQuery
  eq(column: string, value: string): ArtifactQuery
  order(column: string, options: { ascending: boolean }): ArtifactQuery
  range(from: number, to: number): ArtifactQuery
}

export interface ArtifactClient {
  from(table: string): ArtifactQuery
}

/** Narrows a chunked read to one value (`eq`) or a set of them (`in`). */
export type ChunkFilter =
  | { column: string; value: string }
  | { column: string; values: readonly string[] }

export type FetchInChunksOptions = {
  table: string
  /** The column the `ids` are matched against — `job_id`, `pipeline_job_id`, `product_id`, … */
  idColumn: string
  ids: readonly string[]
  columns?: string
  filter?: ChunkFilter
  /** Only ordered when the caller needs it; not every table has a `created_at`. */
  orderBy?: string
  chunkSize?: number
  pageSize?: number
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Read every row matching `ids`, in chunks small enough to keep the query string under the
 * gateway's limit and paged so a response that hits the row cap doesn't silently truncate.
 * Throws on failure — callers must not be able to confuse "the read failed" with "no rows".
 */
export async function fetchInChunks(
  client: ArtifactClient,
  {
    table,
    idColumn,
    ids,
    columns = '*',
    filter,
    orderBy,
    chunkSize = ARTIFACT_CHUNK_SIZE,
    pageSize = ARTIFACT_PAGE_SIZE,
  }: FetchInChunksOptions,
): Promise<ArtifactRow[]> {
  if (ids.length === 0) return []

  // Chunks run concurrently — at 850 jobs the sequential version cost ~1.6s per poll. Pages within
  // a chunk stay sequential because a full page is the only signal that another one exists.
  const chunks = await Promise.all(
    chunk(ids, chunkSize).map(async (idChunk) => {
      const rows: ArtifactRow[] = []
      for (let from = 0; ; from += pageSize) {
        let query = client.from(table).select(columns).in(idColumn, idChunk)
        if (filter) {
          query = 'values' in filter
            ? query.in(filter.column, filter.values)
            : query.eq(filter.column, filter.value)
        }
        if (orderBy) query = query.order(orderBy, { ascending: true })

        const { data, error } = await query.range(from, from + pageSize - 1)

        if (error) throw new Error(error.message)
        if (!data) break

        rows.push(...data)
        if (data.length < pageSize) break
      }
      return rows
    }),
  )

  // Flattened in chunk order, not completion order: callers walk the result assigning
  // `next[row.job_id] = …`, so the newest row for a job has to be the last one they see.
  return chunks.flat()
}

export type FetchArtifactsOptions = {
  jobIds: readonly string[]
  /** A single type uses `eq`, several use `in`. */
  artifactTypes: string | readonly string[]
  /** Defaults to the columns every caller needs. */
  columns?: string
  chunkSize?: number
  pageSize?: number
}

/** `fetchInChunks` for `pipeline_step_artifacts`, which is what most dashboard hooks want. */
export function fetchArtifacts(
  client: ArtifactClient,
  { jobIds, artifactTypes, columns = 'job_id, data', chunkSize, pageSize }: FetchArtifactsOptions,
): Promise<ArtifactRow[]> {
  return fetchInChunks(client, {
    table: TABLE,
    idColumn: 'job_id',
    ids: jobIds,
    columns,
    filter: typeof artifactTypes === 'string'
      ? { column: 'artifact_type', value: artifactTypes }
      : { column: 'artifact_type', values: artifactTypes },
    orderBy: 'created_at',
    chunkSize,
    pageSize,
  })
}
