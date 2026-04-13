import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { useAvatarHeads } from '@/hooks/useAvatarHeads';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface FaceShapeSelectorProps {
  gender: string;
  onSelect: (faceShape: string) => void;
  selectedFaceShape?: string;
}

export function FaceShapeSelector({ gender, onSelect, selectedFaceShape }: FaceShapeSelectorProps) {
  const { getFaceShapes, loading, error } = useAvatarHeads();
  const [faceShapes, setFaceShapes] = useState<Array<{
    id: string;
    name: string;
    image_url: string;
    description: string;
  }>>([]);

  useEffect(() => {
    const loadFaceShapes = async () => {
      console.log('🔄 FaceShapeSelector: Loading face shapes for gender:', gender);
      const shapes = await getFaceShapes(gender);
      console.log('📦 FaceShapeSelector: Received shapes:', shapes);
      setFaceShapes(shapes);
    };

    if (gender) {
      loadFaceShapes();
    }
  }, [gender, getFaceShapes]);

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
        <p className="text-destructive">Error loading face shapes: {error}</p>
      </div>
    );
  }

  console.log('🎨 FaceShapeSelector: Rendering with faceShapes:', faceShapes);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-3 gap-3">
        {faceShapes.map((shape, index) => {
          console.log('🖼️ Rendering shape:', shape.id, 'with image:', shape.image_url);
          return (
            <motion.div
              key={shape.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.4 }}
            >
              <Card
                className={cn(
                  "cursor-pointer transition-all duration-300 hover:shadow-premium hover:-translate-y-1 group",
                  selectedFaceShape === shape.id 
                    ? "ring-2 ring-primary shadow-premium bg-primary/5" 
                    : "hover:shadow-md border-border"
                )}
                onClick={() => onSelect(shape.id)}
              >
                <CardContent className="p-4">
                  <div className="aspect-square relative mb-3 overflow-hidden rounded-lg">
                    <img
                      src={shape.image_url}
                      alt={shape.name}
                      className={cn(
                        "w-full h-full object-contain transition-all duration-300",
                        "group-hover:scale-105",
                        selectedFaceShape === shape.id && "scale-105"
                      )}
                      onError={(e) => {
                        console.error('❌ Image failed to load:', shape.image_url);
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        target.nextElementSibling?.classList.remove('hidden');
                      }}
                      onLoad={() => {
                        console.log('✅ Image loaded successfully:', shape.image_url);
                      }}
                    />
                    {/* Fallback */}
                    <div className="w-full h-full bg-muted rounded-lg flex items-center justify-center hidden">
                      <span className="text-2xl">👤</span>
                    </div>
                    
                    {/* Selection Indicator */}
                    {selectedFaceShape === shape.id && (
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
          );
        })}
      </div>
      {/* Selected pill hidden */}
      {/* {selectedFaceShape && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full">
            <span className="w-2 h-2 bg-primary rounded-full" />
            <p className="text-sm text-primary font-medium">
              {selectedFaceShape.charAt(0).toUpperCase() + selectedFaceShape.slice(1)} selected
            </p>
          </div>
        </motion.div>
      )} */}
    </motion.div>
  );
} 