import { ExploreMoodsCard } from './ExploreMoodsCard';
import { useTopRatedOutfits } from '@/hooks/useTopRatedOutfits';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProfile } from '@/hooks/useProfile';

interface ExploreMoodsProps {
  onCategorySelect: (categorySlug: string, categoryName: string) => void;
}

export function ExploreMoods({ onCategorySelect }: ExploreMoodsProps) {
  const { getUserGender } = useProfile();
  const gender = getUserGender();
  const { categories, loading, error, refetch } = useTopRatedOutfits(gender);

  // Handle category navigation
  const handleCategorySelect = (categorySlug: string, categoryName: string) => {
    onCategorySelect(categorySlug, categoryName);
  };

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
    <div className="space-y-8">
      {/* Subtle Header */}
      <div className="text-center">
        <p className="text-sm text-muted-foreground/80 max-w-md mx-auto leading-relaxed">
          Discover new styles and add them to your preferences
        </p>
      </div>

      {/* Category Grid - Enhanced Layout */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {categories.map((category, index) => (
          <div 
            key={category.categoryId} 
            className="animate-fade-in"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <ExploreMoodsCard
              category={category}
              onPreview={() => handleCategorySelect(category.categorySlug, category.categoryName)}
            />
          </div>
        ))}
      </div>

      {/* Enhanced Instructions */}
      <div className="glass-card rounded-xl p-5 border border-border/30 bg-gradient-to-br from-background/50 to-background/30">
        <div className="flex items-start space-x-3">
          <div className="w-6 h-6 bg-gradient-to-br from-primary/90 to-primary/70 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-xs text-primary-foreground font-medium">✨</span>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Discover Your Style</p>
            <p className="text-xs text-muted-foreground/90 leading-relaxed">
              Tap any category to explore curated outfits and find your perfect look. Each category shows the number of available outfits to help you discover new styles.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
} 