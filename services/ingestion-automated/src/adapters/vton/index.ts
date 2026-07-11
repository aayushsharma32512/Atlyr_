import type { IngestionPipelineJob, TryonProvider } from '../../domain/types';
import { fashnVtonProvider } from './fashn-vton.adapter';
import { geminiVtonProvider } from './gemini-vton.adapter';

// ponytail: seedream adapter gets added here (+ a case below) when it's built —
// resolveVtonModel already throws a clear error for anything else in the meantime.
const PROVIDERS: Record<string, TryonProvider> = {
  fashn_vton: fashnVtonProvider,
  gemini_nano_banana: geminiVtonProvider,
};

export function resolveVtonModel(job: IngestionPipelineJob): TryonProvider {
  // Manual override (job.v_ton_model) wins; otherwise every job routes to gemini by default.
  const requested = job.v_ton_model || 'gemini_nano_banana';
  const provider = PROVIDERS[requested];
  if (!provider) throw new Error(`E_UNKNOWN_VTON_MODEL: no provider registered for '${requested}'`);
  return provider;
}
