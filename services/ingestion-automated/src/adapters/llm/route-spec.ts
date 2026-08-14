// Route spec parsing for the multi-route Gemini transport.
//
// GEMINI_ROUTES is a comma-separated priority list — first healthy route wins:
//
//   GEMINI_ROUTES=ai_studio,vertex:global,vertex:us-central1
//
//   ai_studio          → generativelanguage.googleapis.com with GOOGLE_API_KEY
//                        (fixed per-project RPM/TPM — the only lane the service had before)
//   vertex:<location>  → Vertex AI in that location with ADC credentials
//                        (Dynamic Shared Quota — no preset rate limit; each location is its
//                        own capacity pool, and 'global' lets Google pick a region)
//
// Pure module — no config import — so it stays testable without the env-validating config.

export type LlmRoute =
  | { id: string; kind: 'ai_studio' }
  | { id: string; kind: 'vertex'; location: string };

export function parseRoutes(spec: string): LlmRoute[] {
  const routes: LlmRoute[] = [];
  const seen = new Set<string>();

  for (const raw of spec.split(',')) {
    const token = raw.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);

    if (token === 'ai_studio') {
      routes.push({ id: token, kind: 'ai_studio' });
      continue;
    }

    const vertex = token.match(/^vertex:([a-z0-9-]+|global)$/);
    if (vertex) {
      routes.push({ id: token, kind: 'vertex', location: vertex[1] });
      continue;
    }

    throw new Error(
      `GEMINI_ROUTES: unrecognised route "${token}" — expected "ai_studio" or "vertex:<location>"`,
    );
  }

  if (routes.length === 0) throw new Error('GEMINI_ROUTES: no routes configured');
  return routes;
}
