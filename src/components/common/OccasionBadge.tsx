import { Badge } from '@/components/ui/badge';
import { Occasion } from '@/types';

interface OccasionBadgeProps {
  occasion: Occasion;
  className?: string;
}

export function OccasionBadge({ occasion, className }: OccasionBadgeProps) {
  return (
    <Badge variant="secondary" className={className}>
      {occasion.name}
    </Badge>
  );
}