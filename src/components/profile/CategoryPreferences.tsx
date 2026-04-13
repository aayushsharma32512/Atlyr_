import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { CategoryCard } from '@/components/onboarding/CategoryCard';
import { useTopRatedOutfits } from '@/hooks/useTopRatedOutfits';
import { useProfile } from '@/hooks/useProfile';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle, Save } from 'lucide-react';

interface CategoryPreferencesProps {
  onPreferencesUpdated?: () => void;
}

export function CategoryPreferences({ onPreferencesUpdated }: CategoryPreferencesProps) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const { categories, loading, error, refetch } = useTopRatedOutfits();
  const { profile, updatePreferredCategories } = useProfile();
  const { toast } = useToast();

  // Initialize selected categories from user's profile
  useEffect(() => {
    if (profile?.preferred_categories) {
      setSelectedCategories(profile.preferred_categories);
    }
  }, [profile?.preferred_categories]);

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

  // Handle save preferences
  const handleSavePreferences = async () => {
    if (selectedCategories.length === 0) {
      toast({
        title: "Selection Required",
        description: "Please select at least one category to save.",
        variant: "destructive"
      });
      return;
    }

    try {
      setIsUpdating(true);
      await updatePreferredCategories(selectedCategories);
      
      toast({
        title: "Preferences Updated",
        description: "Your category preferences have been saved successfully.",
      });

      onPreferencesUpdated?.();
    } catch (error) {
      console.error('Error updating preferences:', error);
      toast({
        title: "Update Failed",
        description: "Failed to update your preferences. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle retry on error
  const handleRetry = () => {
    refetch();
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] space-y-4">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading categories...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] space-y-4">
        <AlertCircle className="h-6 w-6 text-destructive" />
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
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">
          Category Preferences
        </h3>
        <p className="text-sm text-muted-foreground">
          Select the categories you're interested in. These will appear in your Discover feed.
        </p>
      </div>

      {/* Category Grid */}
      <div className="grid grid-cols-2 gap-4">
        {categories.map(category => (
          <CategoryCard
            key={category.categoryId}
            category={category}
            isSelected={selectedCategories.includes(category.categoryId)}
            onToggle={handleCategoryToggle}
          />
        ))}
      </div>

      {/* Selection Summary */}
      {selectedCategories.length > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
          <p className="text-sm text-primary font-medium">
            Selected: {selectedCategories.length} {selectedCategories.length === 1 ? 'category' : 'categories'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {categories
              .filter(cat => selectedCategories.includes(cat.categoryId))
              .map(cat => cat.categoryName)
              .join(', ')}
          </p>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={handleSavePreferences}
          disabled={selectedCategories.length === 0 || isUpdating}
          className="flex items-center gap-2"
        >
          {isUpdating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isUpdating ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
} 