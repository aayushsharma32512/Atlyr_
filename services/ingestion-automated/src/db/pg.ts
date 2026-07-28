import { Pool } from 'pg';
import { config } from '../config/index';

// A small direct-Postgres pool (same DATABASE_URL_DIRECT pg-boss uses). Used for the placement
// write path so saving a placement never depends on the Supabase PostgREST layer — which, under
// load, can stall REST requests while direct SQL stays fast.
let _pool: Pool | undefined;

export function pgPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: config.DATABASE_URL_DIRECT, max: 4 });
    _pool.on('error', () => { /* transient idle-client errors are recovered on next acquire */ });
  }
  return _pool;
}
