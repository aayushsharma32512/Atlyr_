import type { IngestionPipelineJob, TryonProvider } from '../../domain/types';
import { fashnVtonProvider } from './fashn-vton.adapter';

// ponytail: only fashn_vton exists so far. seedream / gemini_nano_banana adapters
// get added here (+ a case below) when they're built — resolveVtonModel already
// throws a clear error for anything else in the meantime.
const PROVIDERS: Record<string, TryonProvider> = {
  fashn_vton: fashnVtonProvider,
};

export function resolveVtonModel(job: IngestionPipelineJob): TryonProvider {
  // Manual override (job.v_ton_model) wins; otherwise route by the job's submitted product_complexity.
  const requested = job.v_ton_model || (job.product_complexity === 'simple' ? 'fashn_vton' : 'gemini_nano_banana');
  const provider = PROVIDERS[requested];
  if (!provider) throw new Error(`E_UNKNOWN_VTON_MODEL: no provider registered for '${requested}'`);
  return provider;
}
