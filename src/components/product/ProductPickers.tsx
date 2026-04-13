import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { ColorOption, SizeOption, generateDummyColors, generateDummySizes } from '@/utils/dummyData';

interface ColorPickerProps {
  colors: ColorOption[];
  selectedColor: string;
  onColorChange: (colorId: string) => void;
  className?: string;
}

interface SizePickerProps {
  sizes: SizeOption[];
  selectedSize: string;
  onSizeChange: (sizeId: string) => void;
  className?: string;
}

export function ColorPicker({ colors, selectedColor, onColorChange, className }: ColorPickerProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">Color</h4>
        <span className="text-xs text-muted-foreground">
          {colors.find(c => c.id === selectedColor)?.name}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => (
          <button
            key={color.id}
            onClick={() => onColorChange(color.id)}
            disabled={!color.available}
            className={cn(
              "relative w-8 h-8 rounded-full border-2 transition-all duration-200",
              "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/20",
              selectedColor === color.id
                ? "border-primary ring-2 ring-primary/20"
                : "border-border hover:border-primary/50",
              !color.available && "opacity-40 cursor-not-allowed"
            )}
            style={{ backgroundColor: color.hex }}
            title={color.name}
          >
            {selectedColor === color.id && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-full shadow-sm" />
              </div>
            )}
            {!color.available && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-4 h-px bg-muted-foreground rotate-45" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SizePicker({ sizes, selectedSize, onSizeChange, className }: SizePickerProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">Size</h4>
        <span className="text-xs text-muted-foreground">
          {sizes.find(s => s.id === selectedSize)?.name}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {sizes.map((size) => (
          <button
            key={size.id}
            onClick={() => onSizeChange(size.id)}
            disabled={!size.available}
            className={cn(
              "px-3 py-2 text-sm font-medium rounded-lg border transition-all duration-200",
              "hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary/20",
              selectedSize === size.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:border-primary/50 hover:bg-muted/50",
              !size.available && "opacity-40 cursor-not-allowed line-through"
            )}
          >
            {size.name}
          </button>
        ))}
      </div>
    </div>
  );
}
