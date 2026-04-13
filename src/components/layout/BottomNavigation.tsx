import { Mountain, Search, User, Palette, Shapes } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { useGuest } from '@/contexts/GuestContext';
import { Badge } from '@/components/ui/badge';

interface BottomNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const navItems = [
  { id: 'home', icon: Mountain, label: 'Home' },
  { id: 'collections', icon: Shapes, label: 'Collections' },
  { id: 'studio', icon: Palette, label: 'Studio' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'profile', icon: User, label: 'Profile' }
];

export function BottomNavigation({ activeTab, onTabChange }: BottomNavigationProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const { guestState } = useGuest();

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Show navigation when scrolling up, hide when scrolling down
      setLastScrollY(prevScrollY => {
        if (currentScrollY < prevScrollY) {
          setIsVisible(true);
        } else if (currentScrollY > prevScrollY && currentScrollY > 100) {
          setIsVisible(false);
        }
        return currentScrollY;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div 
      className={cn(
        "fixed bottom-0 left-0 right-0 glass-nav border-t border-border/20 transition-premium z-[120] pb-[env(safe-area-inset-bottom)]",
        isVisible ? "translate-y-0" : "translate-y-full"
      )}
    >
      {/* Use equal-width columns to ensure perfect centering and consistent edge spacing */}
      <div className="grid grid-cols-5 h-12 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "w-full h-full flex flex-col items-center justify-center space-y-1 rounded-xl transition-premium relative min-w-0",
                "active:scale-95",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div
                className={cn(
                  "relative flex flex-col items-center justify-center space-y-1 px-2 py-1 rounded-full",
                  isActive ? "bg-primary/10" : ""
                )}
              >
                <Icon className="w-5 h-5 transition-premium" strokeWidth={1.75} />
                <span className={cn("text-[11px] font-medium", isActive ? "text-foreground" : "")}>{item.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
