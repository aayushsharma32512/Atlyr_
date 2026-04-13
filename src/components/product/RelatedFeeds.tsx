import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/product/ProductCard';
import { OutfitCard } from '@/components/home/OutfitCard';
import { Product, Outfit } from '@/types';
import { cn } from '@/lib/utils';

interface RelatedFeedsProps {
  className?: string;
}

interface SimilarProductsProps extends RelatedFeedsProps {
  products: Product[];
  onProductClick: (product: Product) => void;
}

interface PairItWithProps extends RelatedFeedsProps {
  products: Product[];
  onProductClick: (product: Product) => void;
}

interface CuratedLooksProps extends RelatedFeedsProps {
  outfits: Outfit[];
  onOutfitClick: (outfit: Outfit) => void;
}

// Similar Products Feed
export function SimilarProducts({ products, onProductClick, className }: SimilarProductsProps) {
  const [scrollPosition, setScrollPosition] = useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!containerRef.current) return;
    
    const container = containerRef.current;
    const scrollAmount = container.clientWidth * 0.8;
    
    if (direction === 'left') {
      container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    } else {
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  if (!products || products.length === 0) return null;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Similar Products</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8"
            onClick={() => scroll('left')}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8"
            onClick={() => scroll('right')}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <div
        ref={containerRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide pb-4"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {products.slice(0, 50).map((product) => (
          <div
            key={product.id}
            className="flex-shrink-0 w-48"
            style={{ scrollSnapAlign: 'start' }}
          >
            <ProductCard
              product={product}
              onClick={() => onProductClick(product)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// Pair it with Feed
export function PairItWith({ products, onProductClick, className }: PairItWithProps) {
  const [filter, setFilter] = useState<'wardrobe' | 'new-items'>('new-items');
  const [scrollPosition, setScrollPosition] = useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!containerRef.current) return;
    
    const container = containerRef.current;
    const scrollAmount = container.clientWidth * 0.8;
    
    if (direction === 'left') {
      container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    } else {
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const filteredProducts = filter === 'wardrobe' ? [] : products.slice(0, 50);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Pair it with</h3>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'wardrobe' | 'new-items')}
            className="text-sm border border-border rounded-md px-2 py-1 bg-background"
          >
            <option value="wardrobe">Wardrobe</option>
            <option value="new-items">New Items</option>
          </select>
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8"
            onClick={() => scroll('left')}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8"
            onClick={() => scroll('right')}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      {filter === 'wardrobe' ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Coming soon</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide pb-4"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              className="flex-shrink-0 w-48"
              style={{ scrollSnapAlign: 'start' }}
            >
              <ProductCard
                product={product}
                onClick={() => onProductClick(product)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Curated Looks Feed
export function CuratedLooks({ outfits, onOutfitClick, className }: CuratedLooksProps) {
  if (!outfits || outfits.length === 0) return null;

  return (
    <div className={cn("space-y-4", className)}>
      <h3 className="text-lg font-semibold text-foreground">Curated Looks</h3>
      
      <div className="grid grid-cols-2 gap-4">
        {outfits.map((outfit) => (
          <OutfitCard
            key={outfit.id}
            outfit={outfit}
            onClick={() => onOutfitClick(outfit)}
            maxCardWidth={200}
          />
        ))}
      </div>
    </div>
  );
}
