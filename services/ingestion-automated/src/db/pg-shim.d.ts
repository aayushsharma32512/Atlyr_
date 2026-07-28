// Minimal ambient declaration for `pg` (pulled in transitively by pg-boss; @types/pg not installed).
// Covers only the Pool surface the placement write path uses.
declare module 'pg' {
  export interface QueryResult<R = Record<string, unknown>> {
    rows: R[];
    rowCount: number | null;
  }
  export class Pool {
    constructor(config?: { connectionString?: string; max?: number });
    query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
    on(event: string, listener: (...args: unknown[]) => void): this;
    end(): Promise<void>;
  }
}
