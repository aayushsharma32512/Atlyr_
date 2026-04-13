import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';

interface StudioHeaderProps {
  onBack: () => void;
  rightContent?: ReactNode;
}

export function StudioHeader({ 
  onBack,
  rightContent
}: StudioHeaderProps) {
  return (
    <div className="h-16 bg-background border-b border-border flex items-center px-4 studio-header">
      <div className="flex items-center justify-between w-full">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-foreground">Studio</h1>
        </div>
        
        <div className="flex items-center gap-2">
          {rightContent}
        </div>
      </div>
    </div>
  );
}
