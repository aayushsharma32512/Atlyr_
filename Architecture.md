## Architecture decision: Embedding model for semantic search

### Decision
- Use OpenAI `text-embedding-3-small` as the primary embedding model for outfits semantic search.

### Context
- We are building hybrid search (semantic + keyword) for the outfits search tab. Phase 1 focuses on semantic search quality and time-to-value.

### Options considered
- OpenAI `text-embedding-3-small` (1536-d)
- OpenAI `text-embedding-3-large` (3072-d)
- Open-source small models (e.g., GTE/BGE 384-d), hosted or self-hosted

### Rationale for choice
- Quality: Strong general-domain performance and multilingual support; robust for short consumer queries.
- Simplicity: Managed API with stable SDKs; minimal ops. Fastest to ship.
- Cost: Low at our anticipated volumes (both indexing and query-time).
- Latency: Network call acceptable; overall UX meets budget when paired with ANN search in DB.
- Tradeoff accepted: Larger vectors (1536-d) vs 384-d; storage/index overhead is acceptable for current scale.

### Cost and performance (order-of-magnitude)
- Storage: ~6 KB per row (1536 × 4 bytes). 5k outfits ≈ 30 MB (+ index overhead).
- Query-time: ~100–250 ms to create query embedding + tens of ms DB ANN lookup.
- Indexing: One-time backfill + ongoing updates on create/update.

### Risks and mitigations
- External dependency: API availability/limits → implement retries/backoff; cache embeddings; monitor rate limits.
- Privacy/compliance: Keep API keys server-side (Edge Functions). Send only minimal text fields.
- Model switch later: Use versioned embedding columns and side-by-side backfill to migrate with zero downtime.

### Implementation notes
- DB: `pgvector` enabled; `outfits.embedding_v1 vector(1536)` with HNSW (cosine) index.
- Server: Edge Function to generate embeddings (indexing + query-time). Keep vectors server-side; do not expose in API responses.
- Data to embed: Consistent text document composed of `name`, `description`, `category`, `occasion`, `feel`, `fit` (+ minimal product descriptors if needed).
- Observability: Log function latency, errors, query result counts; alert on missing embeddings.

### Change management
- Future upgrades: Add `embedding_v2` (new dimension/model), backfill in batches, switch traffic via config/flag, then decommission v1.


