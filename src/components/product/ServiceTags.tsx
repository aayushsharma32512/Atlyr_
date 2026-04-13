import React from 'react';
import { Truck, RotateCcw, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ServiceTag {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

interface ServiceTagsProps {
  className?: string;
}

const serviceTags: ServiceTag[] = [
  {
    id: 'delivery',
    icon: Truck,
    title: 'Free Delivery',
    description: 'On orders above ₹999'
  },
  {
    id: 'returns',
    icon: RotateCcw,
    title: '30-Day Returns',
    description: 'Easy returns & exchanges'
  },
  {
    id: 'security',
    icon: Shield,
    title: 'Secure Payment',
    description: '100% secure checkout'
  }
];

export function ServiceTags({ className }: ServiceTagsProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <h4 className="text-sm font-medium text-foreground">Services</h4>
      <div className="space-y-2">
        {serviceTags.map((tag) => {
          const Icon = tag.icon;
          return (
            <div
              key={tag.id}
              className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
            >
              <div className="flex-shrink-0 w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{tag.title}</p>
                <p className="text-xs text-muted-foreground">{tag.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
