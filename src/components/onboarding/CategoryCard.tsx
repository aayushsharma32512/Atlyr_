import React from 'react';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { CategoryWithOutfit } from '@/hooks/useTopRatedOutfits';

interface CategoryCardProps {
  category: CategoryWithOutfit;
  isSelected: boolean;
  onToggle: (categoryId: string) => void;
  disabled?: boolean;
}

export function CategoryCard({ category, isSelected, onToggle, disabled = false }: CategoryCardProps) {

  const handleToggle = () => {
    if (!disabled) {
      onToggle(category.categoryId);
    }
  };

  // Helper function to get category descriptions
  const getCategoryDescription = (categoryName: string): string => {
    const descriptions: Record<string, string> = {
      'For You': 'Personalized recommendations based on your style',
      'Casual Outing': 'Comfortable styles for everyday wear',
      'CEO Core': 'Professional looks for the modern workplace',
      'Date Ready': 'Perfect outfits for special occasions',
      'Old Money': 'Sophisticated and timeless elegance',
      'Streetwear': 'Urban fashion with attitude',
      'Minimalist': 'Clean, simple, and refined',
      'Vintage': 'Classic styles with retro charm',
      'Athleisure': 'Comfort meets style for active lifestyles',
      'Formal': 'Elegant attire for special events'
    };

    return descriptions[categoryName] || 'Discover amazing styles in this category';
  };

  return (
    <div
      className={cn(
        "relative bg-card border-2 rounded-lg p-4 cursor-pointer transition-all duration-200",
        isSelected 
          ? "border-primary bg-primary/5" 
          : "border-border hover:border-primary/50 hover:bg-primary/2",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={handleToggle}
    >
      {/* Selection Checkbox */}
      <div className="absolute top-3 right-3 z-10">
        <Checkbox
          checked={isSelected}
          onChange={handleToggle}
          disabled={disabled}
          className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        />
      </div>

      {/* Category Name */}
      <div className="mb-3">
        <h3 className="font-semibold text-sm text-foreground">
          {category.categoryName}
        </h3>
      </div>

      {/* Placeholder spacing removed per simplified design (image to be added later) */}

      {/* Category Description */}
      <div className="mt-2">
        <p className="text-xs text-muted-foreground leading-tight line-clamp-2">
          {getCategoryDescription(category.categoryName)}
        </p>
      </div>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 left-2 w-2 h-2 bg-primary rounded-full" />
      )}
    </div>
  );
} 