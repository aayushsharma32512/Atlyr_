import { DynamicAvatar } from '@/components/studio/DynamicAvatar';
import { CategoryWithOutfit } from '@/hooks/useTopRatedOutfits';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useProfile } from '@/hooks/useProfile';

interface ExploreMoodsCardProps {
  category: CategoryWithOutfit;
  onPreview: () => void;
}

export function ExploreMoodsCard({ 
  category, 
  onPreview 
}: ExploreMoodsCardProps) {
  const { getUserAvatarUrl } = useProfile();

  const handlePreview = () => {
    onPreview();
  };

  return (
    <div
      className={cn(
        "relative group overflow-hidden rounded-2xl cursor-pointer",
        "card-premium glass-card hover-lift hover-glow",
        "transition-premium hover:scale-[1.02] active:scale-[0.98]",
        "animate-fade-in border border-border/50"
      )}
      onClick={handlePreview}
    >
      {/* Card Image Container with white background for consistency */}
      <div className="aspect-[3/4] relative overflow-hidden bg-background">
        {/* Avatar */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '8%' }}>
          <DynamicAvatar
            items={category.outfit.items}
            backgroundUrl={null}
            containerHeight={200}
            containerWidth={200}
            showShadows={false}
            className="w-full max-w-[200px] transition-premium group-hover:scale-105"
          />
        </div>
      </div>

      {/* Card Content - Compact */}
      <div className="p-2 flex-1">
        <div className="flex flex-col space-y-1">
          {/* Category Name */}
          <h3 className="text-sm font-bold text-foreground text-left truncate group-hover:text-primary transition-premium">
            {category.categoryName}
          </h3>
          
          {/* Category Description */}
          <p className="text-[10px] text-muted-foreground text-left leading-tight line-clamp-2">
            {getCategoryDescription(category.categoryName)}
          </p>

          {/* Outfit Count */}
          <div className="pt-1">
            <span className="text-[10px] text-muted-foreground/80 font-medium">
              {category.outfitCount} outfits
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper function to get category descriptions
function getCategoryDescription(categoryName: string): string {
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
} 