import { useState, useEffect } from 'react';
import { CategoryTabs } from './CategoryTabs';
import { OutfitCard } from './OutfitCard';
import { useOutfits } from '@/hooks/useOutfits';
import { useFavorites } from '@/hooks/useFavorites';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useProfile } from '@/hooks/useProfile';
import { Outfit } from '@/types';
import { Loader2, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { logInteraction, INTERACTION_WEIGHTS } from '@/utils/interactionLogger';
import { Button } from '@/components/ui/button';
import { ExploreMoods } from './ExploreMoods';

interface HomePageProps {
  onOutfitSelect: (outfit: Outfit) => void;
}

export function HomePage({ onOutfitSelect }: HomePageProps) {
  const [activeCategory, setActiveCategory] = useState('for-you');
  // Persisted category name when navigated from Explore Moods during the session
  const [persistedCategoryName, setPersistedCategoryName] = useState<string | null>(
    sessionStorage.getItem('persistedCategoryName') || null
  );
  const { outfits: allOutfits, loading: outfitsLoading, getOutfitsByCategory } = useOutfits();
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const { toggleFavorite, isFavorite } = useFavorites();
  const { categories: customCategories, loading: categoriesLoading } = useCustomCategories();
  const { getUserGender } = useProfile();
  const currentGender = getUserGender();

  const MAX_CARD_WIDTH = 250;

  // Clear debug message showing which database is being used
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  // console.log('🔍 DATABASE DEBUG: Using', isLocal ? 'LOCAL' : 'REMOTE', 'database');
  // console.log('📊 Outfits loaded:', allOutfits.length);
  
  // Set default active category when custom categories load
  useEffect(() => {
    if (customCategories.length > 0 && activeCategory === 'for-you') {
      // Find "For You" category and set it as default
      const forYouCategory = customCategories.find(cat => cat.isForYou);
      if (forYouCategory) {
        setActiveCategory(forYouCategory.slug);
      }
    }
  }, [customCategories, activeCategory]);
  // Clear persisted category label when user explicitly switches to standard tabs
  useEffect(() => {
    const exploreMoods = customCategories.find(cat => cat.isExploreMoods)?.slug;
    const forYou = customCategories.find(cat => cat.isForYou)?.slug;
    if (activeCategory === exploreMoods || activeCategory === forYou) {
      // Do not clear persisted name automatically; keep it until end of session as requested
      return;
    }
  }, [activeCategory, customCategories]);

  // Handler when Explore Moods category is selected
  const handleCategorySelectFromExploreMoods = (categorySlug: string, categoryName: string) => {
    const name = categoryName || customCategories.find(c => c.slug === categorySlug)?.name || null;
    if (name) {
      setPersistedCategoryName(name);
      sessionStorage.setItem('persistedCategoryName', name);
    }
    setActiveCategory(categorySlug);
  };


  // Success message when data loads
  useEffect(() => {
    if (allOutfits.length > 0) {
      // Data loaded successfully
    }
  }, [allOutfits.length, isLocal]);

  // Initialize infinite scroll
  const {
    visibleItems: displayedOutfits,
    loading: infiniteLoading,
    hasMore: hasMoreItems,
    lastElementRef,
    reset: resetInfiniteScroll
  } = useInfiniteScroll(outfits, {
    itemsPerPage: 6,
    threshold: 0.1
  });

  useEffect(() => {
    const loadCategoryOutfits = async () => {
      if (!outfitsLoading && allOutfits.length > 0) {
        const categoryOutfits = await getOutfitsByCategory(activeCategory, currentGender);
        setOutfits(categoryOutfits);
        // Reset infinite scroll when category changes
        resetInfiniteScroll();
      }
    };

    loadCategoryOutfits();
  // Depend on currentGender string value instead of the function to avoid re-runs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, allOutfits, outfitsLoading, resetInfiniteScroll, getOutfitsByCategory, currentGender]);

  if (outfitsLoading || categoriesLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center space-y-4 animate-fade-in">
        <div className="animate-float">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-body text-muted-foreground">
            {outfitsLoading ? 'Loading your outfits...' : 'Loading categories...'}
          </p>
          <p className="text-label text-secondary-2">This might take a moment</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Fixed Top Navigation */}
      <CategoryTabs 
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        selectedCategoryName={persistedCategoryName}
      />

      {/* Content Area */}
      <div className="flex-1 p-4 pt-20 pb-20">
        {/* Render Explore Moods if that category is selected */}
        {activeCategory === 'explore-moods' ? (
          <ExploreMoods 
            onCategorySelect={handleCategorySelectFromExploreMoods}
          />
        ) : outfits.length > 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {displayedOutfits.map((outfit) => (
                <OutfitCard
                  key={outfit.id}
                  outfit={outfit}
                  maxCardWidth={MAX_CARD_WIDTH}
                  onClick={() => onOutfitSelect(outfit)}
                  onFavoriteToggle={() => {
                    const isCurrentlyFavorite = isFavorite(outfit.id);
                    toggleFavorite(outfit);
                    
                    // Log different interactions based on action
                    if (isCurrentlyFavorite) {
                      // User is removing from favorites
                      logInteraction(
                        'favorite_remove',
                        outfit.id,
                        outfit.category,
                        INTERACTION_WEIGHTS.favorite_remove,
                        {
                          outfit_name: outfit.name,
                          outfit_price: outfit.totalPrice,
                          outfit_items_count: outfit.items.length,
                          outfit_items: outfit.items.map(item => ({
                            type: item.type,
                            brand: item.brand,
                            price: item.price
                          })),
                          source_view: 'home'
                        }
                      );
                    } else {
                      // User is adding to favorites
                      logInteraction(
                        'favorite_add',
                        outfit.id,
                        outfit.category,
                        INTERACTION_WEIGHTS.favorite_add,
                        {
                          outfit_name: outfit.name,
                          outfit_price: outfit.totalPrice,
                          outfit_items_count: outfit.items.length,
                          outfit_items: outfit.items.map(item => ({
                            type: item.type,
                            brand: item.brand,
                            price: item.price
                          })),
                          source_view: 'home'
                        }
                      );
                    }
                  }}
                  isFavorite={isFavorite(outfit.id)}
                />
              ))}
            </div>

            {/* Infinite Scroll Loading Indicator */}
            {infiniteLoading && (
              <div className="flex justify-center pt-6">
                <div className="glass-card px-4 py-3 rounded-full flex items-center gap-3 text-muted-foreground animate-fade-in">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm font-medium">Loading more looks...</span>
                </div>
              </div>
            )}

            {/* End of Content Message */}
            {!hasMoreItems && outfits.length > 0 && (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  You've seen all {outfits.length} looks in {activeCategory.replace('-', ' ')}!
                </p>
              </div>
            )}

            {/* Intersection Observer Target */}
            {hasMoreItems && (
              <div ref={lastElementRef} className="h-4" />
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 animate-fade-in">
            <div className="w-20 h-20 glass-card rounded-full flex items-center justify-center mb-6 animate-float">
              <span className="text-3xl">👔</span>
            </div>
            <h3 className="text-header text-foreground mb-3">No outfits yet</h3>
            <p className="text-body text-muted-foreground text-center max-w-sm">
              Check back soon for new {activeCategory.replace('-', ' ')} looks to discover!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
