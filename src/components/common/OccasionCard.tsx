import { Card, CardContent } from '@/components/ui/card';
import { Occasion } from '@/types';
import { Palette } from 'lucide-react';

interface OccasionCardProps {
  occasion: Occasion;
  onSelect?: () => void;
  className?: string;
}

export function OccasionCard({ occasion, onSelect, className }: OccasionCardProps) {
  return (
    <Card 
      className={`cursor-pointer transition-all hover:scale-105 ${className}`}
      onClick={onSelect}
    >
      <CardContent className="p-4 flex flex-col items-center space-y-2">
        <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-accent">
          <img 
            src={occasion.backgroundUrl} 
            alt={occasion.name}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="text-center">
          <p className="text-label font-medium">{occasion.name}</p>
          <p className="text-secondary-2 text-xs">{occasion.description}</p>
        </div>
      </CardContent>
    </Card>
  );
}