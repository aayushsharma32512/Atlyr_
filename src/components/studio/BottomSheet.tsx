import React, { useState, useRef, useEffect } from 'react';
import { motion, PanInfo, useMotionValue, useTransform } from 'framer-motion';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/constants';
import { OutfitItem } from '@/types';

interface BottomSheetProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose?: () => void;
  className?: string;
  totalPrice?: number;
  outfitItems?: OutfitItem[];
}

export function BottomSheet({ children, isOpen, onClose, className, totalPrice, outfitItems }: BottomSheetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 100], [1, 0]);

  // Generate compressed state summary
  const generateCompressedSummary = (items: OutfitItem[] = []) => {
    const typeMap: Record<string, string> = { 
      top: 'Top', 
      bottom: 'Bottom', 
      shoes: 'Shoes' 
    };
    
    const summary = items
      .filter(item => ['top', 'bottom', 'shoes'].includes(item.type))
      .map(item => `${typeMap[item.type]}: ${item.brand}`)
      .join(' • ');
    
    return summary;
  };

  const compressedSummary = generateCompressedSummary(outfitItems);
  
  const handleDragEnd = (event: any, info: PanInfo) => {
    const threshold = 100;
    if (info.offset.y > threshold) {
      setIsExpanded(false);
    } else if (info.offset.y < -threshold) {
      setIsExpanded(true);
    }
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className={cn(
        'fixed bottom-0 left-0 right-0 z-[70] glass-nav border-t border-border rounded-t-2xl shadow-2xl',
        className
      )}
      style={{ 
        bottom: '3rem', // Account for bottom navigation height
        ...(y ? { y } : {})
      }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.1}
      onDragEnd={handleDragEnd}
    >
      {/* Compact Handle with Visual Cues */}
      <div className="flex justify-center pt-2 pb-1 bottom-sheet-handle">
        <div className="flex flex-col items-center space-y-1">
          {/* Main handle with subtle animation */}
          <motion.div 
            className="w-12 h-1.5 bg-muted-foreground/40 rounded-full cursor-grab active:cursor-grabbing"
            animate={{ 
              scale: [1, 1.1, 1],
              opacity: [0.4, 0.7, 0.4]
            }}
            transition={{ 
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />
          {/* Compressed State Summary */}
          <div className="text-center space-y-1">
            {/* Items summary and price (font size: base) */}
            {compressedSummary && (
              <motion.div 
                className="text-base text-muted-foreground/80 font-medium"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                {compressedSummary} | {formatCurrency(totalPrice || 0)}
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <motion.div
        animate={{ height: isExpanded ? '70vh' : '0px' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="overflow-hidden"
      >
        <div className={cn(
          "px-4 h-full flex flex-col",
          isExpanded ? "pb-4" : "pb-0"
        )}>
          {isExpanded ? (
            children
          ) : (
            // Compressed state - no content
            null
          )}
        </div>
      </motion.div>
    </motion.div>
  );
} 