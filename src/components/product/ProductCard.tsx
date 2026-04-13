import React from 'react';
import { Product } from '../../types';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { HorizontalImageScroll } from './HorizontalImageScroll';
import { useProductImages } from '../../hooks/useProductImages';
import { SimilarityBadge } from '../ui/similarity-badge';
import { FEATURE_FLAGS } from '@/utils/constants';

interface ProductCardProps {
  product: Product & { similarityScore?: number };
  onClick?: () => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  const { allImages } = useProductImages(product.id, product.image_url);

  return (
    <Card 
      className="cursor-pointer transition-all duration-300 bg-background border-border/40 rounded-xl overflow-hidden group active:scale-[0.98]"
      onClick={onClick}
    >
      <CardContent className="p-0">
        {/* Image Container - Clean White Background */}
        <div className="relative overflow-hidden bg-white">
          {/* Similarity Badge - Only show if similarity score exists */}
          {FEATURE_FLAGS.SHOW_SIMILARITY_BADGE && product.similarityScore !== undefined && (
            <SimilarityBadge score={product.similarityScore} />
          )}
          
          <HorizontalImageScroll images={allImages} />
        </div>
        
        {/* Product Details with Cream/Beige Background */}
        <div className="p-3 space-y-2 bg-orange-50/30">
          {/* Brand and Price - Compact Single Line */}
          <div className="flex justify-between items-center gap-2">
            <span className="text-xs font-semibold text-foreground/90 capitalize truncate">
              {product.brand}
            </span>
            <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md whitespace-nowrap">
              ₹{product.price.toLocaleString()}
            </span>
          </div>
          
          {/* Product Name - Compact Single Line */}
          <h3 className="text-xs font-medium text-foreground leading-tight line-clamp-1">
            {product.product_name || `${product.brand} ${product.type}`}
          </h3>
          
          {/* Tags/Pills - Horizontally Scrollable */}
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            {/* Vibes */}
            {product.vibesArray && product.vibesArray.length > 0 && product.vibesArray.map((vibe, index) => (
              <Badge 
                key={`vibe-${index}`} 
                variant="secondary" 
                className="text-xs px-2 py-1 flex-shrink-0 bg-muted/50 text-muted-foreground border-0 rounded-full font-normal"
              >
                {vibe}
              </Badge>
            ))}
            
            {/* Fit */}
            {product.fitArray && product.fitArray.length > 0 && product.fitArray.map((fit, index) => (
              <Badge 
                key={`fit-${index}`} 
                variant="outline" 
                className="text-xs px-2 py-1 flex-shrink-0"
              >
                {fit}
              </Badge>
            ))}
            
            {/* Feel */}
            {product.feelArray && product.feelArray.length > 0 && product.feelArray.map((feel, index) => (
              <Badge 
                key={`feel-${index}`} 
                variant="outline" 
                className="text-xs px-2 py-1 flex-shrink-0"
              >
                {feel}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
