import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Occasion } from '@/types';
import { dataTransformers } from '@/utils/dataTransformers';

export function useOccasions() {
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOccasions();
  }, []);

  const fetchOccasions = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: occasionsError } = await supabase
        .from('occasions')
        .select('*')
        .order('name');

      if (occasionsError) throw occasionsError;

      // Transform database data using centralized transformer
      const transformedOccasions: Occasion[] = (data || []).map(occasion => dataTransformers.occasion(occasion));

      setOccasions(transformedOccasions);
    } catch (err) {
      console.error('Error fetching occasions:', err);
      setError('Failed to fetch occasions');
    } finally {
      setLoading(false);
    }
  };

  return {
    occasions,
    loading,
    error,
    refetch: fetchOccasions
  };
}