import { supabase } from '@/integrations/supabase/client';

export interface InteractionMetadata {
  [key: string]: any;
}

export const logInteraction = async (
  interactionType: string,
  outfitId: string,
  category: string,
  weight: number = 5,
  metadata: InteractionMetadata = {}
) => {
  // Debug logging for interaction tracking (dev only)
  if ((import.meta as any).env?.DEV) {
    console.log('🔍 INTERACTION DEBUG:', {
      type: interactionType,
      outfitId,
      category,
      weight,
      metadata,
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      if ((import.meta as any).env?.DEV) {
        console.warn('⚠️ User not authenticated, skipping interaction log');
      }
      return;
    }

    console.log('👤 User authenticated:', user.id);

    const { error } = await supabase
      .from('user_interactions')
      .insert({
        user_id: user.id,
        outfit_id: outfitId,
        interaction_type: interactionType,
        category: category,
        weight: weight,
        metadata: metadata
      });

    if (error) {
      console.error('❌ Failed to log interaction:', error);
    } else {
      console.log('✅ Interaction logged successfully:', {
        type: interactionType,
        outfitId,
        category,
        weight
      });
    }
  } catch (error) {
    if ((import.meta as any).env?.DEV) {
      console.error('❌ Error logging interaction:', error);
    }
  }
};

import { APP_CONSTANTS } from './constants';

// Use centralized interaction weights
export const INTERACTION_WEIGHTS = APP_CONSTANTS.INTERACTION_WEIGHTS; 