import { useState } from 'react';
import React from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Heart, 
  ShoppingBag, 
  Loader2, 
  TrendingUp, 
  Calendar,
  Filter,
  Grid3X3,
  Palette,
  Crown,
  Sparkles,
  MoreHorizontal
} from 'lucide-react';
import { OutfitCard } from '@/components/home/OutfitCard';
import { useFavorites } from '@/hooks/useFavorites';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { Outfit } from '@/types';
import { logInteraction, INTERACTION_WEIGHTS } from '@/utils/interactionLogger';
import { formatCurrency } from '@/utils/constants';
import { cn } from '@/lib/utils';

interface FavoritesScreenProps {
  onOutfitSelect: (outfit: Outfit) => void;
  showHeader?: boolean;
}

export function FavoritesScreen({ onOutfitSelect, showHeader = true }: FavoritesScreenProps) {
  const { favorites, loading, removeFavorite } = useFavorites();
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  
  // Filter favorites first, then apply infinite scroll
  const filteredFavorites = selectedFilter === 'all' 
    ? favorites 
    : favorites.filter(f => {
        if (selectedFilter === 'business') return f.category === 'ceo-core';
        if (selectedFilter === 'casual') return f.category === 'casual-outing';
        if (selectedFilter === 'date-ready') return f.category === 'date-ready';
        return f.category === selectedFilter;
      });

  // Initialize infinite scroll for filtered favorites
  const {
    visibleItems: displayedFavorites,
    loading: infiniteLoading,
    hasMore: hasMoreItems,
    lastElementRef,
    reset: resetInfiniteScroll
  } = useInfiniteScroll(filteredFavorites, {
    itemsPerPage: 6,
    threshold: 0.1
  });

  // Reset infinite scroll when filter changes
  React.useEffect(() => {
    resetInfiniteScroll();
  }, [selectedFilter, resetInfiniteScroll]);

  // Group favorites by categories to get accurate counts
  const collections = {
    'date-ready': favorites.filter(f => f.category === 'date-ready').length,
    'business': favorites.filter(f => f.category === 'ceo-core').length,
    'casual': favorites.filter(f => f.category === 'casual-outing').length,
    'streetwear': favorites.filter(f => f.category === 'streetwear').length,
    'old-money': favorites.filter(f => f.category === 'old-money').length
  };

  const filterOptions = [
    { id: 'all', label: 'All', count: favorites.length },
    { id: 'date-ready', label: 'Date Night', count: collections['date-ready'] },
    { id: 'business', label: 'Work', count: collections.business },
    { id: 'casual', label: 'Casual', count: collections.casual },
    { id: 'streetwear', label: 'Street', count: collections.streetwear },
    { id: 'old-money', label: 'Old Money', count: collections['old-money'] }
  ].filter(option => option.count > 0); // Only show categories that have favorites

  return (
    <PageLayout>
      <div className="space-y-4">
        {/* Simple Header */}
        {showHeader && (
          <div>
            <h1 className="text-xl font-bold mb-1">Favorites</h1>
            <p className="text-sm text-muted-foreground">Your saved outfits</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading your favorites...</p>
            </div>
          </div>
        )}

        {!loading && favorites.length === 0 && (
          <Card className="card-premium">
            <CardContent className="p-12 text-center">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                <Heart className="w-12 h-12 text-primary" />
              </div>
              <h3 className="text-header mb-3">Your style vault awaits</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto text-body">
                Save outfits that speak to your style. Build your personal collection of looks you love and want to recreate.
              </p>
              <Button 
                className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-premium"
                onClick={() => window.history.back()}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Explore Outfits
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && favorites.length > 0 && (
          <>
            {/* Category Filter Chips - Horizontally Scrollable */}
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2"
                 style={{ 
                   scrollbarWidth: 'none', 
                   msOverflowStyle: 'none',
                   WebkitOverflowScrolling: 'touch'
                 }}>
              {filterOptions.map((filter) => (
                <Button
                  key={filter.id}
                  variant={selectedFilter === filter.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    console.log('Filter clicked:', filter.id); // Debug log
                    setSelectedFilter(filter.id);
                  }}
                  className={cn(
                    "flex-shrink-0 text-xs h-8 whitespace-nowrap",
                    selectedFilter === filter.id && "bg-gradient-to-r from-primary to-primary/80"
                  )}
                >
                  {filter.label}
                  {filter.count > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs px-1 py-0 h-4">
                      {filter.count}
                    </Badge>
                  )}
                </Button>
              ))}
            </div>

            {/* Results Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">
                {selectedFilter === 'all' ? 'All Favorites' : filterOptions.find(f => f.id === selectedFilter)?.label}
              </h2>
              <span className="text-xs text-muted-foreground">
                {filteredFavorites.length} outfit{filteredFavorites.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Favorites Grid - Consistent spacing and sizing */}
            {filteredFavorites.length > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                {displayedFavorites.map((outfit, index) => (
                  <div 
                    key={outfit.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <OutfitCard
                      outfit={outfit}
                      onClick={() => onOutfitSelect(outfit)}
                      onFavoriteToggle={() => {
                        removeFavorite(outfit.id);
                        logInteraction(
                          'favorite_remove',
                          outfit.id,
                          outfit.category,
                          INTERACTION_WEIGHTS.favorite_remove,
                          {
                            outfit_name: outfit.name,
                            outfit_price: outfit.totalPrice,
                            outfit_items_count: outfit.items.length,
                            source_view: 'favorites'
                          }
                        );
                      }}
                      isFavorite={true}
                      maxCardWidth={280}
                      className="hover-lift hover-glow shadow-premium hover:shadow-premium-hover"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-t border-border/50 pt-8">
                <Card className="card-premium">
                  <CardContent className="p-8 text-center">
                    <Filter className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <h3 className="font-medium mb-2">No outfits in this category</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      You haven't saved any {filterOptions.find(f => f.id === selectedFilter)?.label.toLowerCase()} outfits yet
                    </p>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setSelectedFilter('all')}
                    >
                      View All Favorites
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Infinite Scroll Indicators */}
            {infiniteLoading && (
              <div className="flex justify-center pt-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading more...</span>
                </div>
              </div>
            )}

            {!hasMoreItems && filteredFavorites.length > 6 && (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  You've seen all favorites in this category
                </p>
              </div>
            )}

            {hasMoreItems && (
              <div ref={lastElementRef} className="h-4" />
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}
