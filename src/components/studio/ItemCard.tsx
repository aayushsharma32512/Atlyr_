import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Sparkles, Star, Shirt, Users, Footprints, ShoppingBag, Palette, Circle, Square, Triangle, Check } from 'lucide-react';
import { OutfitItem } from '@/types';
import { formatCurrency } from '@/utils/constants';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

interface ItemCardProps {
  item: OutfitItem;
  className?: string;
  isSelected?: boolean;
  onSelectionChange?: (itemId: string, selected: boolean) => void;
}

const getCategoryIcon = (type: string) => {
  switch (type) {
    case 'top': return <Shirt className="w-5 h-5 text-foreground" />;
    case 'bottom': return <Users className="w-5 h-5 text-foreground" />;
    case 'shoes': return <Footprints className="w-5 h-5 text-foreground" />;
    default: return <Shirt className="w-5 h-5 text-foreground" />;
  }
};

const buildColorTokens = (value?: string | null) => {
  if (!value) {
    return [];
  }
  return value
    .split(/[,/&]/)
    .map((token) => token.trim())
    .filter(Boolean);
};

export function ItemCard({ item, className, isSelected = false, onSelectionChange }: ItemCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const navigate = useNavigate();
  const ratingValue = typeof item.rating === 'number' ? item.rating : null;
  const sizeOptions = useMemo(() => {
    if (item.sizeOptions && item.sizeOptions.length > 0) {
      return item.sizeOptions;
    }
    return item.size ? [item.size] : [];
  }, [item.size, item.sizeOptions]);
  const colorTokens = useMemo(() => {
    if (item.colorSwatches && item.colorSwatches.length > 0) {
      return item.colorSwatches;
    }
    return buildColorTokens(item.color);
  }, [item.color, item.colorSwatches]);

  // Helper: Title case for multi-word names (from product_id)
  const toTitleCase = (value: string | undefined) => {
    if (!value) return '';
    return value
      .toLowerCase()
      .split(' ')
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Tag pill color mapping (consistent, light backgrounds)
  type PillKind = 'category' | 'fit' | 'feel1' | 'feel2';
  const getTypePillClasses = (kind: PillKind) => {
    const baseClasses = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium';
    switch (kind) {
      case 'category': return `${baseClasses} bg-blue-50 text-blue-700 border border-blue-200`;
      case 'fit': return `${baseClasses} bg-green-50 text-green-700 border border-green-200`;
      case 'feel1': return `${baseClasses} bg-purple-50 text-purple-700 border border-purple-200`;
      case 'feel2': return `${baseClasses} bg-orange-50 text-orange-700 border border-orange-200`;
      default: return `${baseClasses} bg-gray-50 text-gray-700 border border-gray-200`;
    }
  };

  // Handle checkbox click without triggering card expansion
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectionChange?.(item.id, !isSelected);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleSelect = () => {
    if (isExpanded) {
      // Navigate to PDP when expanded
      navigate(`/product/${item.id}`);
    } else {
      // Toggle expansion when not expanded
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <motion.div
      layout
      className={cn(
        'bg-card border border-border rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-all duration-200',
        className
      )}
      onClick={handleSelect}
    >
      <AnimatePresence mode="wait">
        {!isExpanded ? (
          // Compressed State (48px)
          <motion.div
            key="compressed"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: '48px' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="flex items-center space-x-3">
              <div className="flex items-center justify-center w-6 h-6">
                {getCategoryIcon(item.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {item.brand} • {item.size} • {formatCurrency(item.price)}
                </p>
              </div>
            </div>
            <button
              onClick={handleToggle}
              className="p-1 rounded-full hover:bg-muted transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </motion.div>
        ) : (
          // Expanded State (side-by-side layout)
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3"
          >
            <div className="grid grid-cols-[110px_minmax(0,1fr)_48px] gap-3 items-start">
              {/* Col 1: Product Image + Ratings + Pills */}
              <div className="w-[110px] flex flex-col">
                <div className="w-[110px] h-[110px] bg-muted rounded-lg flex items-center justify-center overflow-hidden">
                  <img
                    src={item.imageUrl}
                    alt={item.description}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <Sparkles className="w-6 h-6 text-muted-foreground hidden" />
                </div>
                <div className="mt-2 space-y-2">
                  {/* Ratings row (moved under image) */}
                  <div className="flex items-center gap-1.5">
                    {ratingValue !== null ? (
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                        <span className="text-xs font-medium text-foreground">{ratingValue.toFixed(1)}</span>
                      </div>
                    ) : null}
                  </div>

                  {/* Pill tags (moved under image) */}
                  <div className="flex flex-wrap gap-1 w-full max-w-[110px]">
                    {(() => {
                      const category = (item as OutfitItem & { category_id?: string }).category_id;
                      const fit = item.fit?.trim();
                      const feelParts = (item.feel || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean);
                      const firstFeel = feelParts[0];
                      const secondFeel = feelParts.length > 1 ? feelParts[1] : undefined;
                      const pills: { label: string; kind: PillKind }[] = [];
                      if (category) pills.push({ label: category, kind: 'category' });
                      if (fit) pills.push({ label: fit, kind: 'fit' });
                      if (firstFeel) pills.push({ label: firstFeel, kind: 'feel1' });
                      if (secondFeel) pills.push({ label: secondFeel, kind: 'feel2' });
                      return pills.map(({ label, kind }) => (
                        <span key={`${kind}-${label}`} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] leading-4 font-medium ${getTypePillClasses(kind)}`}>
                          {label}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
              </div>

              {/* Col 2: Content Stack */}
              <div className="min-w-0 flex flex-col gap-1.5">
                {/* Top row: Brand + Price */}
                <div className="flex items-center justify-between min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-foreground truncate">{item.brand}</span>
                    <span className="text-sm font-semibold text-foreground whitespace-nowrap">{formatCurrency(item.price)}</span>
                  </div>
                </div>

                {/* Name (from product_id) */}
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug line-clamp-2">
                    {toTitleCase(item.id)}
                  </p>
                </div>

                {/* Description */}
                {item.description && (
                  <p className="text-xs text-muted-foreground leading-snug line-clamp-3">
                    {item.description}
                  </p>
                )}

                {/* Ratings and Pill tags moved under the image (left column) */}

                {/* Size chips */}
                {sizeOptions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {sizeOptions.map((size) => (
                      <span
                        key={size}
                        className={cn(
                          'px-2 py-1 text-xs rounded border',
                          size === item.size ? 'bg-black text-white border-black' : 'bg-background border-border text-foreground',
                        )}
                      >
                        {size}
                      </span>
                    ))}
                  </div>
                ) : null}

                {/* Color swatches */}
                {colorTokens.length ? (
                  <div className="flex flex-wrap gap-2">
                    {colorTokens.map((color) => (
                      <span
                        key={color}
                        className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                      >
                        {color}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Col 3: Actions (chevron first, then checkbox) */}
              <div className="flex flex-col items-end justify-start space-y-2">
                <button
                  onClick={handleToggle}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  aria-label="Collapse"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCheckboxClick}
                  className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-200',
                    isSelected ? 'bg-primary border-primary' : 'bg-background border-border hover:border-primary/50'
                  )}
                  aria-label="Select item"
                >
                  {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}