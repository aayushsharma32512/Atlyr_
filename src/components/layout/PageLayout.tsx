import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: ReactNode;
  className?: string;
}

export function PageLayout({ children, className }: PageLayoutProps) {
  return (
    <div className={cn("px-4 md:px-5 py-4 pb-24 pb-[env(safe-area-inset-bottom)] min-h-screen", className)}>
      {children}
    </div>
  );
}
