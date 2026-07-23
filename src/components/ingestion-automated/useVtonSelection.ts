import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import type { PipelineJob, SlotKey, SlotMapResult } from '@/utils/ingestionV2Api'

export type ImageSlot = { url: string; uncertain: boolean; manual: boolean } | null

export type SlotMap = {
  frontModel: ImageSlot
  frontFlat: ImageSlot
  backModel: ImageSlot
  backFlat: ImageSlot
}

export const EMPTY_SLOTS: SlotMap = { frontModel: null, frontFlat: null, backModel: null, backFlat: null }

const KEY_MAP: Record<SlotKey, keyof SlotMap> = {
  front_model: 'frontModel', front_flat: 'frontFlat', back_model: 'backModel', back_flat: 'backFlat',
}

function toSlotMap(raw: SlotMapResult | undefined): SlotMap {
  if (!raw) return EMPTY_SLOTS
  const out: SlotMap = { ...EMPTY_SLOTS }
  for (const k of Object.keys(KEY_MAP) as SlotKey[]) {
    const v = raw[k]
    if (v) out[KEY_MAP[k]] = { url: v.publicUrl, uncertain: v.uncertain, manual: v.manual }
  }
  return out
}

export type VtonSelection = { slots: SlotMap; preferredSlot: keyof SlotMap | null }

// Reads the vton_image_selection artifact identifying.handler.ts (and now retag.ts) write —
// the authoritative, server-resolved slot picks, including any manual overrides. Keyed on
// job.updated_at like the other row-level hooks, so it refetches the moment identification
// finishes and actually creates this artifact (that write also bumps the job row). The extra
// explicit refetch() covers retags that only touch a non-preferred slot, which doesn't
// necessarily touch the job row.
export function useVtonSelection(jobs: PipelineJob[]) {
  const [map, setMap] = useState<Record<string, VtonSelection>>({})
  const [nonce, setNonce] = useState(0)
  const ids = jobs.map(j => j.job_id)
  const key = jobs.map(j => `${j.job_id}:${j.updated_at}`).join(',')

  const load = useCallback(async () => {
    if (ids.length === 0) { setMap({}); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('pipeline_step_artifacts')
      .select('job_id, data')
      .in('job_id', ids)
      .eq('artifact_type', 'vton_image_selection')
      .order('created_at', { ascending: true })
    if (error) { console.error('useVtonSelection', error); return }
    if (!data) return

    const next: Record<string, VtonSelection> = {}
    for (const row of data as { job_id: string; data: Record<string, unknown> | null }[]) {
      const raw = row.data?.slots as SlotMapResult | undefined
      const preferredRaw = row.data?.preferred_slot as SlotKey | null | undefined
      // Ascending order — later rows (more recent) overwrite earlier ones.
      next[row.job_id] = {
        slots: toSlotMap(raw),
        preferredSlot: preferredRaw ? KEY_MAP[preferredRaw] : null,
      }
    }
    setMap(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => { load() }, [load, nonce])

  return { selections: map, refetch: () => setNonce(n => n + 1) }
}
