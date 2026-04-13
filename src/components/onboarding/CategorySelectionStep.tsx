import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { CategoryCard } from './CategoryCard';
import { useTopRatedOutfits } from '@/hooks/useTopRatedOutfits';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle } from 'lucide-react';

interface CategorySelectionStepProps {
  onNext: (selectedCategories: string[]) => void;
  onBack: () => void;
  // Remove navigation buttons from this component since parent handles them
}

export function CategorySelectionStep({ onNext, onBack }: CategorySelectionStepProps) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const { categories, loading, error, refetch } = useTopRatedOutfits();
  const { toast } = useToast();

  // Handle category selection toggle
  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(id => id !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  };

  // Update parent form data when categories change
  useEffect(() => {
    onNext(selectedCategories);
  }, [selectedCategories]); // Remove onNext from dependencies to prevent infinite loop

  // Handle retry on error
  const handleRetry = () => {
    refetch();
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading categories...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">Failed to load categories</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={handleRetry} variant="outline" size="sm">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Spacer for visual balance */}
      <div className="h-4" />

      {/* Category Grid */}
      <div className="grid grid-cols-2 gap-4">
        {categories.map((category, index) => (
          <motion.div
            key={category.categoryId}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.1, duration: 0.4 }}
          >
            <CategoryCard
              category={category}
              isSelected={selectedCategories.includes(category.categoryId)}
              onToggle={handleCategoryToggle}
            />
          </motion.div>
        ))}
      </div>

      {/* Selection Summary */}
      {selectedCategories.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-xl p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 bg-primary rounded-full" />
            <p className="text-sm text-primary font-semibold">
              {selectedCategories.length} {selectedCategories.length === 1 ? 'category' : 'categories'} selected
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {categories
              .filter(cat => selectedCategories.includes(cat.categoryId))
              .map(cat => cat.categoryName)
              .join(', ')}
          </p>
        </motion.div>
      )}

      {/* Navigation handled by parent OnboardingFlow component */}
    </motion.div>
  );
} 