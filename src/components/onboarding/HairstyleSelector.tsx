import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { useAvatarHeads } from '@/hooks/useAvatarHeads';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface HairstyleSelectorProps {
  gender: string;
  faceShape: string;
  skinTone: string;
  onSelect: (hairstyle: string, avatarId: string, scalingFactor: number, imageUrl: string) => void;
  selectedHairstyle?: string;
}

export function HairstyleSelector({ 
  gender, 
  faceShape, 
  skinTone, 
  onSelect, 
  selectedHairstyle 
}: HairstyleSelectorProps) {
  const { getHairstyles, loading, error } = useAvatarHeads();
  const [hairstyles, setHairstyles] = useState<Array<{
    id: string;
    name: string;
    image_url: string;
    description: string;
    avatar_id: string;
    scaling_factor: number;
  }>>([]);

  useEffect(() => {
    const loadHairstyles = async () => {
      const styles = await getHairstyles(gender, faceShape, skinTone);
      setHairstyles(styles);
    };

    if (faceShape && skinTone) {
      loadHairstyles();
    }
  }, [gender, faceShape, skinTone, getHairstyles]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive">Error loading hairstyles: {error}</p>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-3 gap-3">
        {hairstyles.map((style, index) => (
          <motion.div
            key={style.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.4 }}
          >
            <Card
              className={cn(
                "cursor-pointer transition-all duration-300 hover:shadow-premium hover:-translate-y-1 group",
                selectedHairstyle === style.id 
                  ? "ring-2 ring-primary shadow-premium bg-primary/5" 
                  : "hover:shadow-md border-border"
              )}
              onClick={() => onSelect(style.id, style.avatar_id, style.scaling_factor, style.image_url)}
            >
              <CardContent className="p-4">
                <div className="aspect-square relative mb-3 overflow-hidden rounded-lg">
                  <img
                    src={style.image_url}
                    alt={style.name}
                    className={cn(
                      "w-full h-full object-contain transition-all duration-300",
                      "group-hover:scale-105",
                      selectedHairstyle === style.id && "scale-105"
                    )}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  {/* Fallback */}
                  <div className="w-full h-full bg-muted rounded-lg flex items-center justify-center hidden">
                    <span className="text-2xl">👤</span>
                  </div>
                  
                  {/* Selection Indicator */}
                  {selectedHairstyle === style.id && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center"
                    >
                      <span className="text-primary-foreground text-sm">✓</span>
                    </motion.div>
                  )}
                </div>
                
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
      {/* Selected pill hidden */}
      {/* {selectedHairstyle && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full">
            <span className="w-2 h-2 bg-primary rounded-full" />
            <p className="text-sm text-primary font-medium">
              {selectedHairstyle.charAt(0).toUpperCase() + selectedHairstyle.slice(1)} selected
            </p>
          </div>
        </motion.div>
      )} */}
    </motion.div>
  );
} 