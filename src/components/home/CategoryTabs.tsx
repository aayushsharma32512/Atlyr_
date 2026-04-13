import { useState, useEffect, useRef } from 'react';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { cn } from '@/lib/utils';

interface CategoryTabsProps {
  activeCategory: string;
  onCategoryChange: (categorySlug: string) => void;
  // Optional: when viewing a category selected from Explore Moods, persistently display its name
  selectedCategoryName?: string | null;
}

export function CategoryTabs({ activeCategory, onCategoryChange, selectedCategoryName }: CategoryTabsProps) {
  const { categories, loading, error } = useCustomCategories();
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Scroll-based visibility logic
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Show/hide based on scroll direction and position
      if (currentScrollY > 100) { // Threshold for hiding
        if (currentScrollY > lastScrollY) {
          // Scrolling down - hide
          setIsVisible(false);
        } else {
          // Scrolling up - show
          setIsVisible(true);
        }
      } else {
        // Near top - always show
        setIsVisible(true);
      }
      
      setLastScrollY(currentScrollY);
    };

    // Add passive scroll listener for performance
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [lastScrollY]);

  // Auto-center active tab
  useEffect(() => {
    if (activeTabRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const activeTab = activeTabRef.current;
      
      // Calculate center position
      const containerWidth = container.offsetWidth;
      const tabWidth = activeTab.offsetWidth;
      const tabLeft = activeTab.offsetLeft;
      const tabCenter = tabLeft + tabWidth / 2;
      const containerCenter = containerWidth / 2;
      
      // Calculate scroll position to center the tab
      const scrollLeft = tabCenter - containerCenter;
      
      // Smooth scroll to center the active tab
      container.scrollTo({
        left: scrollLeft,
        behavior: 'smooth'
      });
    }
  }, [activeCategory]);

  // Loading state
  if (loading) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 h-16 bg-card/95 backdrop-blur-sm border-b border-border shadow-lg transition-transform duration-300">
        <div className="h-full flex items-center px-4">
          <div className="text-sm font-medium text-muted-foreground">
            Loading categories...
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 h-16 bg-card/95 backdrop-blur-sm border-b border-border shadow-lg transition-transform duration-300">
        <div className="h-full flex items-center px-4">
          <div className="text-sm font-medium text-destructive">
            Failed to load categories
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "fixed top-0 left-0 right-0 z-50 h-16 glass-nav transition-premium",
        isVisible ? "translate-y-0" : "-translate-y-full"
      )}
    >
      <div className="h-full flex items-center">
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto scrollbar-hide"
        >
          <div className="flex space-x-6 px-4 min-w-max">
            {categories.map((category) => (
              <button
                key={category.id}
                ref={activeCategory === category.slug ? activeTabRef : null}
                onClick={() => onCategoryChange(category.slug)}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-premium whitespace-nowrap relative rounded-lg",
                  "hover:scale-105 active:scale-95",
                  activeCategory === category.slug
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                {/* Active indicator */}
                {activeCategory === category.slug && (
                  <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full animate-scale-in" />
                )}
                {category.name}
              </button>
            ))}
            {/* Persisted category name from Explore Moods */}
            {selectedCategoryName && !categories.some(c => c.slug === activeCategory) && (
              <div
                className={cn(
                  "px-4 py-2 text-sm font-semibold whitespace-nowrap rounded-lg",
                  "text-primary"
                )}
              >
                {selectedCategoryName}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}