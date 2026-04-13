import React from 'react';
import { cn } from '@/lib/utils';

interface SimilarityBadgeProps {
  score: number;
  className?: string;
}

export function SimilarityBadge({ score, className }: SimilarityBadgeProps) {
  // Convert similarity score to percentage (0-100)
  const percentage = Math.round(score * 100);
  
  // Determine color and label based on similarity range
  const getBadgeStyle = (score: number) => {
    if (score >= 0.9) {
      return {
        bgColor: 'bg-green-500/90',
        textColor: 'text-white',
        label: 'Excellent'
      };
    } else if (score >= 0.8) {
      return {
        bgColor: 'bg-blue-500/90',
        textColor: 'text-white',
        label: 'Very Good'
      };
    } else if (score >= 0.7) {
      return {
        bgColor: 'bg-yellow-500/90',
        textColor: 'text-white',
        label: 'Good'
      };
    } else if (score >= 0.6) {
      return {
        bgColor: 'bg-orange-500/90',
        textColor: 'text-white',
        label: 'Fair'
      };
    } else {
      return {
        bgColor: 'bg-red-500/90',
        textColor: 'text-white',
        label: 'Poor'
      };
    }
  };

  const badgeStyle = getBadgeStyle(score);

  return (
    <div
      className={cn(
        'absolute top-2 right-2 z-10',
        'px-2 py-1 rounded-md',
        'text-xs font-semibold',
        'backdrop-blur-sm shadow-sm',
        'border border-white/20',
        badgeStyle.bgColor,
        badgeStyle.textColor,
        'transition-all duration-200',
        'hover:scale-105',
        className
      )}
      title={`${badgeStyle.label} match: ${percentage}%`}
    >
      {percentage}%
    </div>
  );
}
