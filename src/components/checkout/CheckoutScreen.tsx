import { useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Outfit } from '@/types';
import { DynamicAvatar } from '@/components/studio/DynamicAvatar';
import { formatCurrency } from '@/utils/constants';

export function CheckoutScreen() {
  const { outfitId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const outfit: Outfit = location.state?.outfit;

  if (!outfit) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Outfit not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 bg-background border-b border-border">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-semibold text-foreground">Order Summary</h1>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-6">
        {/* Outfit Preview */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-4">
              <div className="w-16 h-20 relative bg-muted rounded-lg overflow-hidden">
                <img 
                  src={outfit.occasion.backgroundUrl}
                  alt={outfit.occasion.name}
                  className="w-full h-full object-cover opacity-50"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <DynamicAvatar 
                    items={outfit.items}
                    className="scale-[0.3]"
                  />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{outfit.name}</h3>
                <p className="text-sm text-muted-foreground">{outfit.items.length} items</p>
                <p className="text-lg font-bold text-foreground">{formatCurrency(outfit.totalPrice)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Order Items */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">Items</h3>
          {outfit.items.map((item, index) => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-muted rounded-lg overflow-hidden">
                    <img 
                      src={item.imageUrl}
                      alt={item.description}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-foreground">{item.description}</h4>
                    <p className="text-sm text-muted-foreground">{item.brand} • Size: {item.size}</p>
                    <p className="text-sm font-medium text-foreground">Qty: 1</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground">{formatCurrency(item.price)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Delivery Address */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <MapPin className="w-5 h-5 text-muted-foreground" />
              <div className="flex-1">
                <h4 className="font-medium text-foreground">Delivery Address</h4>
                <p className="text-sm text-muted-foreground">Add delivery address</p>
              </div>
              <Button variant="outline" size="sm">Add</Button>
            </div>
          </CardContent>
        </Card>

        {/* Order Total */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground">{formatCurrency(outfit.totalPrice)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shipping</span>
              <span className="text-foreground">Free</span>
            </div>
            <div className="border-t pt-2">
              <div className="flex justify-between">
                <span className="font-semibold text-foreground">Total</span>
                <span className="font-bold text-foreground">{formatCurrency(outfit.totalPrice)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Proceed Button */}
      <div className="p-4 border-t border-border">
        <Button className="w-full h-12 text-lg font-semibold">
          Proceed to Payment
        </Button>
      </div>
    </div>
  );
}