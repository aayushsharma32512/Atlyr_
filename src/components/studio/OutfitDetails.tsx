import React, { useState } from 'react';
import { Outfit, OutfitItem } from '@/types';
import { formatCurrency } from '@/utils/constants';
import { ItemCard } from './ItemCard';
import { BottomSheet } from './BottomSheet';
import { Button } from '@/components/ui/button';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { useToast } from '@/hooks/use-toast';

interface OutfitDetailsProps {
  currentOutfit: Outfit;
}

export function OutfitDetails({ currentOutfit }: OutfitDetailsProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const { addToCart } = useCart();
  const { toast } = useToast();

  const totalPrice = currentOutfit.items.reduce((sum, item) => sum + (item.price || 0), 0);

  // Calculate total price of selected items
  const selectedItemsTotal = currentOutfit.items
    .filter(item => selectedItems.has(item.id))
    .reduce((sum, item) => sum + (item.price || 0), 0);

  // Handle item selection
  const handleItemSelection = (itemId: string, selected: boolean) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }
      return newSet;
    });
  };

  // Handle add to cart
  const handleAddToCart = () => {
    if (selectedItems.size === 0) {
      toast({
        title: "No items selected",
        description: "Please select at least one item to add to cart.",
        variant: "destructive"
      });
      return;
    }

    // Add each selected item to cart
    selectedItems.forEach(itemId => {
      const item = currentOutfit.items.find(item => item.id === itemId);
      if (item) {
        // Create a single-item outfit for cart
        const singleItemOutfit: Outfit = {
          id: `single-${item.id}`,
          name: `${item.brand} ${item.description}`,
          category: item.type,
          totalPrice: item.price,
          currency: item.currency,
          occasion: currentOutfit.occasion,
          items: [item]
        };
        
        addToCart(singleItemOutfit, { [item.id]: item.size });
      }
    });

    // Show success notification
    toast({
      title: "Items added to cart",
      description: `${selectedItems.size} item${selectedItems.size === 1 ? '' : 's'} added to cart successfully.`,
    });

    // Clear selections
    setSelectedItems(new Set());
  };

  return (
    <BottomSheet isOpen={true} totalPrice={totalPrice} outfitItems={currentOutfit.items}>
      <div className="flex flex-col h-full">
        {/* Scrollable Items List */}
        <div className="flex-1 overflow-y-auto space-y-2 pb-4">
          {currentOutfit.items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              isSelected={selectedItems.has(item.id)}
              onSelectionChange={handleItemSelection}
            />
          ))}
        </div>

        {/* Sticky Add to Cart Button */}
        <div className="pt-4 border-t border-border/50 bg-background/95 backdrop-blur-sm">
          <Button 
            onClick={handleAddToCart}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all duration-200 hover:shadow-lg"
            disabled={selectedItems.size === 0}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            {selectedItems.size > 0 
              ? `Add to Cart - ${formatCurrency(selectedItemsTotal)}`
              : 'Add to Cart'
            }
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
} 