import { supabase } from '@/integrations/supabase/client';

type AvatarHeadMeta = {
  placement_x: number;
  scaling_factor: number | null;
  chin_placement: number;
};

const cache = new Map<string, AvatarHeadMeta>();
const inFlight = new Map<string, Promise<AvatarHeadMeta>>();

async function fetchMeta(id: string): Promise<AvatarHeadMeta> {
  const { data, error } = await supabase
    .from('avatar_heads')
    .select('placement_x, scaling_factor, chin_placement')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    return { placement_x: 0, scaling_factor: null, chin_placement: 0 };
  }
  const placement_x = typeof (data as any).placement_x === 'number' ? (data as any).placement_x : 0;
  const scaling_factor = typeof (data as any).scaling_factor === 'number' ? (data as any).scaling_factor : null;
  const chin_raw = typeof (data as any).chin_placement === 'number' ? (data as any).chin_placement : 0;
  const chin_placement = Math.max(0, Math.min(100, chin_raw));
  return { placement_x, scaling_factor, chin_placement };
}

export async function getAvatarHeadMetaCached(id: string): Promise<AvatarHeadMeta> {
  if (!id) return { placement_x: 0, scaling_factor: null, chin_placement: 0 };
  if (cache.has(id)) return cache.get(id)!;
  if (inFlight.has(id)) return inFlight.get(id)!;
  const promise = fetchMeta(id)
    .then((meta) => { cache.set(id, meta); inFlight.delete(id); return meta; })
    .catch((e) => { inFlight.delete(id); return { placement_x: 0, scaling_factor: null, chin_placement: 0 }; });
  inFlight.set(id, promise);
  return promise;
}

