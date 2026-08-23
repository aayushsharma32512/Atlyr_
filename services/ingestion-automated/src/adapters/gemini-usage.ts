/**
 * Token counts returned by the Gemini API (`usageMetadata`). Persisted per call so spend can
 * be computed exactly rather than estimated — `thoughtsTokenCount` is billed as output, so
 * total_tokens (not prompt+candidates) is the figure to price against.
 *
 * Lives apart from `gemini.ts` only so the batch protocol helpers can share one implementation
 * without importing `config`, which validates env at import time and kills a test process
 * when env is absent.
 */
export interface TokenUsage {
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export function readUsage(meta: unknown): TokenUsage | null {
  const m = meta as Record<string, number> | undefined;
  if (!m || typeof m.totalTokenCount !== 'number') return null;
  const prompt = m.promptTokenCount ?? 0;
  return {
    prompt_tokens: prompt,
    output_tokens: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0),
    total_tokens: m.totalTokenCount,
  };
}
