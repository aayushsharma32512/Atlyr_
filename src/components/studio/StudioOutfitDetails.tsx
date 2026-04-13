import React from 'react';
import { OutfitItem } from '@/types';
import { formatCurrency } from '@/utils/constants';
import { useNavigate } from 'react-router-dom';

interface StudioOutfitDetailsProps {
  currentOutfit: { items: OutfitItem[] };
  onItemSelect: (item: OutfitItem) => void;
}

export function StudioOutfitDetails({ currentOutfit, onItemSelect }: StudioOutfitDetailsProps) {
  const navigate = useNavigate();

  const handleItemClick = (item: OutfitItem) => {
    navigate(`/product/${item.id}`);
  };

  return (
    <div className="space-y-4 mb-6 p-4">
      <h3 className="text-lg font-semibold text-foreground">
        Outfit Details - {formatCurrency(currentOutfit.items.reduce((sum, item) => sum + (item.price || 0), 0))}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        {currentOutfit.items.map((item) => (
          <div
            key={item.id}
            className="bg-card border border-border rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow flex flex-col"
            onClick={() => handleItemClick(item)}
          >
            <div className="aspect-square bg-muted rounded overflow-hidden mb-3">
              <img 
                src={item.imageUrl}
                alt={item.description}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">{item.brand} • {item.description}</p>
              <p className="text-xs text-muted-foreground">Size: {item.size} • {formatCurrency(item.price)}</p>
            </div>
          </div>
        ))}
        {/* Occasion (Vibe) tile */}
        <div
          className="bg-card border border-border rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow flex flex-col"
          onClick={() => onItemSelect({ 
            id: 'occasion', 
            type: 'occasion', 
            brand: 'Occasion', 
            description: 'Background Theme', 
            imageUrl: '/Backgrounds/7.png', 
            price: 0, 
            size: 'N/A' 
          } as OutfitItem)}
        >
          <div className="aspect-square bg-muted rounded overflow-hidden mb-3">
            <img 
              src="/Backgrounds/7.png"
              alt="Occasion Background"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Background Theme</p>
            <p className="text-xs text-muted-foreground">Tap to change</p>
          </div>
        </div>
      </div>
    </div>
  );
} 