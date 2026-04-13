import React, { useState } from 'react';
import { Star, ThumbsUp, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Review, generateDummyReviews } from '@/utils/dummyData';

interface ProductReviewsProps {
  reviews: Review[];
  averageRating: number;
  totalReviews: number;
  className?: string;
}

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' }) {
  const stars = Array.from({ length: 5 }, (_, i) => i + 1);
  const sizeClasses = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  
  return (
    <div className="flex items-center gap-1">
      {stars.map((star) => (
        <Star
          key={star}
          className={cn(
            sizeClasses,
            star <= rating
              ? 'fill-yellow-400 text-yellow-400'
              : 'text-gray-300'
          )}
        />
      ))}
    </div>
  );
}

export function ProductReviews({ reviews, averageRating, totalReviews, className }: ProductReviewsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Reviews Header - Always Visible */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StarRating rating={Math.round(averageRating)} size="md" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {averageRating.toFixed(1)} out of 5
            </p>
            <p className="text-xs text-muted-foreground">
              Based on {totalReviews} reviews
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? 'Show Less' : `View All (${totalReviews})`}
        </Button>
      </div>

      {/* Reviews List - Only visible when expanded */}
      {isExpanded && (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="border-b border-border/50 pb-4 last:border-b-0">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                    <span className="text-xs font-medium text-primary">
                      {review.author.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{review.author}</p>
                    <div className="flex items-center gap-2">
                      <StarRating rating={review.rating} size="sm" />
                      {review.verified && (
                        <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                          Verified
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{review.date}</span>
              </div>
              
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-foreground">{review.title}</h5>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {review.comment}
                </p>
                
                <div className="flex items-center gap-4 pt-2">
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <ThumbsUp className="w-3 h-3" />
                    Helpful ({review.helpful})
                  </button>
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <MessageCircle className="w-3 h-3" />
                    Reply
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Write Review Button */}
          <Button variant="outline" className="w-full">
            Write a Review
          </Button>
        </div>
      )}
    </div>
  );
}
