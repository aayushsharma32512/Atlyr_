import { useEffect, useMemo, useState } from 'react';
import { Star, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OutfitItem } from '@/types';
import { formatCurrency } from '@/utils/constants';
import { cn } from '@/lib/utils';

interface EnhancedProductCardProps {
  item: OutfitItem;
  onSizeChange?: (size: string) => void;
  onColorChange?: (color: string) => void;
  onCollapse?: () => void; // optional collapse handler from parent
  onSeeMore?: () => void; // optional see more handler for navigation
}

// Fixed pastel themes by pill type so colors are always consistent per type
type PillKind = 'category' | 'fit' | 'feel1' | 'feel2';
const getTypePillClasses = (kind: PillKind) => {
  switch (kind) {
    case 'category':
      return 'bg-rose-100 text-rose-800'; // category_id
    case 'fit':
      return 'bg-sky-100 text-sky-800'; // fit
    case 'feel1':
      return 'bg-emerald-100 text-emerald-800'; // first feel
    case 'feel2':
      return 'bg-purple-100 text-purple-800'; // second feel
    default:
      return 'bg-slate-100 text-slate-800';
  }
};

export function EnhancedProductCard({ item, onSizeChange, onColorChange, onCollapse, onSeeMore }: EnhancedProductCardProps) {
  const ratingValue = typeof item.rating === 'number' ? item.rating : null;
  const normalizedColors = useMemo(
    () =>
      Array.from(
        new Set(
          [item.color, item.color_group]
            .filter((value): value is string => Boolean(value && value.trim()))
            .flatMap((value) =>
              value
                .split(/[,/&]/)
                .map((token) => token.trim())
                .filter(Boolean),
            ),
        ),
      ),
    [item.color, item.color_group],
  );
  const baseSizeLabel = item.size?.trim() || '';
  const sizeOptions = useMemo(() => {
    if (item.sizeOptions && item.sizeOptions.length > 0) {
      return item.sizeOptions;
    }
    return baseSizeLabel ? [baseSizeLabel] : [];
  }, [baseSizeLabel, item.sizeOptions]);
  const colorOptions = useMemo(() => {
    if (item.colorSwatches && item.colorSwatches.length > 0) {
      return item.colorSwatches;
    }
    return normalizedColors;
  }, [item.colorSwatches, normalizedColors]);
  const [selectedSize, setSelectedSize] = useState(sizeOptions[0] ?? '');
  const [selectedColor, setSelectedColor] = useState(colorOptions[0] ?? '');

  useEffect(() => {
    const next = sizeOptions[0] ?? '';
    setSelectedSize(next);
    if (next) {
      onSizeChange?.(next);
    }
  }, [onSizeChange, sizeOptions]);

  useEffect(() => {
    const next = colorOptions[0] ?? '';
    setSelectedColor(next);
    if (next) {
      onColorChange?.(next);
    }
  }, [colorOptions, onColorChange]);

  const handleSizeChange = (size: string) => {
    setSelectedSize(size);
    onSizeChange?.(size);
  };

  const handleColorChange = (color: string) => {
    setSelectedColor(color);
    onColorChange?.(color);
  };

  const handleSeeMore = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSeeMore?.();
  };

  const toTitleCase = (value: string | undefined) => {
    if (!value) return '';
    return value
      .toLowerCase()
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const productName = toTitleCase(item.id);

  return (
    <div className="w-full p-2">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-foreground truncate max-w-[55%]">{item.brand}</span>
          <span className="text-xs font-semibold text-foreground whitespace-nowrap">{formatCurrency(item.price)}</span>
        </div>
        <button type="button" aria-label="Collapse" onClick={onCollapse} className="p-1 rounded hover:bg-muted/50">
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </button>
      </div>

      <div className="mt-0.5 mb-1">
        <span className="text-[12px] text-foreground leading-snug block line-clamp-2 max-w-full">{productName}</span>
      </div>

      {ratingValue !== null ? (
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="flex items-center gap-1">
            <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
            <span className="text-xs font-medium text-foreground">{ratingValue.toFixed(1)}</span>
          </div>
        </div>
      ) : null}

      {sizeOptions.length ? (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-[10px] text-muted-foreground uppercase">Size</span>
          <div className="flex flex-wrap gap-1.5">
            {sizeOptions.map((size) => (
              <button
                key={size}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleSizeChange(size);
                }}
                className={cn(
                  'px-2 py-0.5 text-[11px] rounded-full border transition-colors',
                  selectedSize === size
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {colorOptions.length ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {colorOptions.map((color) => (
            <button
              key={color}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleColorChange(color);
              }}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors',
                selectedColor === color
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/40',
              )}
            >
              {color}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 mb-2">
        {(() => {
          const category = (item as OutfitItem & { category_id?: string }).category_id;
          const fit = item.fit?.trim();
          const feelParts = (item.feel || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const firstFeel = feelParts[0];
          const secondFeel = feelParts.length > 1 ? feelParts[1] : undefined;
          const pills: { label: string; kind: PillKind }[] = [];
          if (category) pills.push({ label: category, kind: 'category' });
          if (fit) pills.push({ label: fit, kind: 'fit' });
          if (firstFeel) pills.push({ label: firstFeel, kind: 'feel1' });
          if (secondFeel) pills.push({ label: secondFeel, kind: 'feel2' });

          return pills.map(({ label, kind }) => (
            <span
              key={`${kind}-${label}`}
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getTypePillClasses(kind)}`}
            >
              {label}
            </span>
          ));
        })()}
      </div>

      {onSeeMore ? (
        <div className="mb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSeeMore}
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground border-border/50 hover:border-border"
          >
            See more
          </Button>
        </div>
      ) : null}

      <div className="border border-border rounded-md p-1.5 mb-2 max-h-24 overflow-y-auto scrollbar-hide">
        <p className="text-[11px] text-foreground leading-snug whitespace-pre-line">{item.description}</p>
      </div>
    </div>
  );
}