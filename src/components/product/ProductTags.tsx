import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ProductTagsProps {
  vibes: string | null;
  fit: string | null;
  feel: string | null;
  className?: string;
}

export function ProductTags({ vibes, fit, feel, className }: ProductTagsProps) {
  // Extract comma-separated words from each field
  const extractWords = (text: string | null): string[] => {
    if (!text) return [];
    return text
      .split(',')
      .map(word => word.trim())
      .filter(word => word.length > 0 && word !== 'nan' && word !== 'null');
  };

  // Combine all words from vibes, fit, and feel
  const allWords = [
    ...extractWords(vibes),
    ...extractWords(fit),
    ...extractWords(feel)
  ];

  // Remove duplicates while preserving order
  const uniqueWords = Array.from(new Set(allWords));

  if (uniqueWords.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
        {uniqueWords.map((word, index) => (
          <Badge
            key={`${word}-${index}`}
            variant="outline"
            className="flex-shrink-0 whitespace-nowrap border-border bg-muted/60 text-foreground/90 px-2 py-0.5 text-[11px] rounded-full"
          >
            {word}
          </Badge>
        ))}
      </div>
    </div>
  );
}
