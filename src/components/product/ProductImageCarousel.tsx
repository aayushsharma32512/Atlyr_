import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProductImage {
  id: string;
  url: string;
  alt: string;
}

interface ProductImageCarouselProps {
  images: ProductImage[];
  className?: string;
}

export function ProductImageCarousel({ images, className }: ProductImageCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lockAppliedRef = useRef<boolean>(false);

  // Update translateX when currentIndex changes
  useEffect(() => {
    setTranslateX(-currentIndex * 100);
  }, [currentIndex]);

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  // Touch handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    const t = e.touches[0];
    setStartX(t.clientX);
    startPosRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    lockAppliedRef.current = false;
    // Ensure a sane default that allows vertical page scroll at start
    if (carouselRef.current) {
      (carouselRef.current as HTMLElement).style.touchAction = 'pan-y';
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const t = e.touches[0];
    const start = startPosRef.current;
    if (!start) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Direction lock: when mostly horizontal, temporarily disable native scrolling
    if (!lockAppliedRef.current && Math.abs(dx) > Math.abs(dy) * 2.5) {
      if (carouselRef.current) {
        (carouselRef.current as HTMLElement).style.touchAction = 'none';
      }
      lockAppliedRef.current = true;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const currentX = e.changedTouches[0].clientX;
    const diff = startX - currentX;
    const threshold = 50; // Minimum distance for swipe
    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
    // Restore default touch-action so vertical scroll works after gesture
    if (carouselRef.current) {
      (carouselRef.current as HTMLElement).style.touchAction = 'pan-y';
    }
    lockAppliedRef.current = false;
    startPosRef.current = null;
    setIsDragging(false);
  };

  // Mouse handlers for desktop
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setStartX(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    // We don't need to preventDefault for selection in this UI
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging) return;
    
    const currentX = e.clientX;
    const diff = startX - currentX;
    const threshold = 50;

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }

    setIsDragging(false);
  };

  if (!images || images.length === 0) {
    return (
      <div className={cn("aspect-square bg-muted rounded-lg flex items-center justify-center", className)}>
        <p className="text-muted-foreground">No images available</p>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-lg", className)}>
      {/* Carousel Container */}
      <div
        ref={carouselRef}
        className="relative w-full h-full"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setIsDragging(false)}
        style={{ touchAction: 'pan-y' }}
      >
        {/* Images Container */}
        <div
          className="flex transition-transform duration-300 ease-out h-full"
          style={{ transform: `translateX(${translateX}%)` }}
        >
          {images.map((image, index) => (
            <div
              key={image.id}
              className="w-full h-full flex-shrink-0 bg-white"
            >
              <img
                src={image.url}
                alt={image.alt}
                className="w-full h-full object-contain"
                draggable={false}
              />
            </div>
          ))}
        </div>

        {/* Navigation Arrows */}
        {images.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background/90 rounded-full w-8 h-8"
              onClick={goToPrevious}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background/90 rounded-full w-8 h-8"
              onClick={goToNext}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>

      {/* Dot Indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex space-x-2">
          {images.map((_, index) => (
            <button
              key={index}
              className={cn(
                "w-2 h-2 rounded-full transition-all duration-200",
                index === currentIndex
                  ? "bg-primary scale-125"
                  : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
              onClick={() => goToSlide(index)}
              aria-label={`Go to image ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Image Counter */}
      {images.length > 1 && (
        <div className="absolute top-4 right-4 bg-background/80 px-2 py-1 rounded-full text-xs font-medium">
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>
  );
}
