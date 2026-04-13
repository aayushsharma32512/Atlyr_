import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Silhouette } from '@/types';
import { dataTransformers } from '@/utils/dataTransformers';

// Module-level cache and in-flight request deduplication
let cachedSilhouettes: Silhouette[] | null = null;
let inFlight: Promise<Silhouette[]> | null = null;

export function useSilhouettes() {
  const [silhouettes, setSilhouettes] = useState<Silhouette[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSilhouettes();
  }, []);

  const fetchSilhouettes = async () => {
    try {
      // Serve from cache immediately
      if (cachedSilhouettes) {
        setSilhouettes(cachedSilhouettes);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      // Deduplicate concurrent requests
      if (!inFlight) {
        inFlight = (async () => {
          const { data, error: silhouettesError } = await supabase
            .from('silhouettes')
            .select('*')
            .order('name');

          if (silhouettesError) throw silhouettesError;
          const transformed: Silhouette[] = (data || []).map(s => dataTransformers.silhouette(s));
          cachedSilhouettes = transformed;
          return transformed;
        })();
      }

      const result = await inFlight;
      setSilhouettes(result);
    } catch (err) {
      console.error('Error fetching silhouettes:', err);
      setError('Failed to fetch silhouettes');
    } finally {
      setLoading(false);
      // Clear inFlight after resolution to allow future refreshes if needed
      inFlight = null;
    }
  };

  return {
    silhouettes,
    loading,
    error,
    refetch: fetchSilhouettes
  };
}
