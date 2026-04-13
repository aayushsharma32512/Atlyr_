import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGuest } from '@/contexts/GuestContext';
import { Outfit } from '@/types';
import { dataTransformers } from '@/utils/dataTransformers';
import { APP_CONSTANTS } from '@/utils/constants';

const CART_STORAGE_KEY = APP_CONSTANTS.STORAGE_KEYS.CART;

interface CartItem {
  id: string;
  outfit: Outfit;
  quantity: number;
  selectedSizes: { [itemId: string]: string };
  addedAt: string;
}

interface Cart {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
}

const defaultCart: Cart = {
  items: [],
  totalItems: 0,
  totalPrice: 0
};

export function useCart() {
  const { user } = useAuth();
  const { guestState, addToCart: addToGuestCart, removeFromCart: removeFromGuestCart } = useGuest();
  const [cart, setCart] = useState<Cart>(defaultCart);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchCart();
    } else if (guestState.isGuest) {
      loadGuestCart();
    } else {
      loadFromLocalStorage();
    }
  }, [user, guestState.isGuest]);

  const loadGuestCart = () => {
    try {
      // Guest cart is managed by GuestContext
      const guestCartItems = guestState.cart || [];
      const cartItems: CartItem[] = guestCartItems.map((item: any) => ({
        id: item.id,
        outfit: item.outfit,
        quantity: item.quantity || 1,
        selectedSizes: item.selectedSizes || {},
        addedAt: item.addedAt || new Date().toISOString()
      }));

      const updatedCart = {
        ...defaultCart,
        items: cartItems,
        totalItems: cartItems.reduce((sum, item) => sum + item.quantity, 0),
        totalPrice: cartItems.reduce((sum, item) => sum + (item.outfit.totalPrice * item.quantity), 0)
      };

      setCart(updatedCart);
    } catch (error) {
      console.error('Error loading guest cart:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFromLocalStorage = () => {
    try {
      const savedCart = localStorage.getItem(CART_STORAGE_KEY);
      if (savedCart) {
        setCart(JSON.parse(savedCart));
      }
    } catch (error) {
      console.error('Error loading cart:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCart = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('user_cart')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;

      // NEW: Fetch outfits with direct product references
      const { data: outfitData, error: outfitError } = await supabase
        .from('outfits')
        .select(`
          *,
          occasion:occasions!occasion(id, name, slug, background_url, description),
          top:products!outfits_top_id_fkey(*),
          bottom:products!outfits_bottom_id_fkey(*),
          shoes:products!outfits_shoes_id_fkey(*)
        `)
        .in('id', (data || []).map(item => item.outfit_id));

      if (outfitError) throw outfitError;

      // Transform database cart items to local cart format
      const dbItems = data || [];
      const syncedItems: CartItem[] = [];

      dbItems.forEach(dbItem => {
        const outfitRecord = outfitData?.find(o => o.id === dbItem.outfit_id);
        if (outfitRecord) {
          // Use centralized data transformer
          const outfit = dataTransformers.outfit(outfitRecord);

          syncedItems.push({
            id: dbItem.id,
            outfit,
            quantity: dbItem.quantity,
            selectedSizes: dbItem.selected_sizes as { [itemId: string]: string },
            addedAt: dbItem.added_at
          });
        }
      });

      const syncedCart = {
        ...defaultCart,
        items: syncedItems,
        totalItems: syncedItems.reduce((sum, item) => sum + item.quantity, 0),
        totalPrice: syncedItems.reduce((sum, item) => sum + (item.outfit.totalPrice * item.quantity), 0)
      };

      setCart(syncedCart);
    } catch (err) {
      setError('Failed to fetch cart');
      loadFromLocalStorage();
    } finally {
      setLoading(false);
    }
  };

  // Save cart to localStorage whenever it changes (only for non-guest users)
  useEffect(() => {
    if (!guestState.isGuest) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    }
  }, [cart, guestState.isGuest]);

  const addToCart = async (outfit: Outfit, selectedSizes: { [itemId: string]: string } = {}) => {
    const newItem: CartItem = {
      id: `${outfit.id}-${Date.now()}`,
      outfit,
      selectedSizes,
      quantity: 1,
      addedAt: new Date().toISOString()
    };

    if (guestState.isGuest) {
      // For guests, use guest context
      addToGuestCart({
        id: newItem.id,
        outfit: newItem.outfit,
        quantity: newItem.quantity,
        selectedSizes: newItem.selectedSizes,
        addedAt: newItem.addedAt
      });

      setCart(prev => {
        const newItems = [...prev.items, newItem];
        return {
          ...prev,
          items: newItems,
          totalItems: newItems.reduce((sum, item) => sum + item.quantity, 0),
          totalPrice: newItems.reduce((sum, item) => sum + (item.outfit.totalPrice * item.quantity), 0)
        };
      });
      return;
    }

    if (user) {
      try {
        const { data, error } = await supabase
          .from('user_cart')
          .insert({
            user_id: user.id,
            outfit_id: outfit.id,
            quantity: 1,
            selected_sizes: selectedSizes
          })
          .select()
          .single();

        if (error) throw error;

        newItem.id = data.id;
      } catch (err) {
        console.error('Failed to add item to database cart:', err);
        // Continue with local storage fallback
      }
    }

    setCart(prev => {
      const newItems = [...prev.items, newItem];
      const updatedCart = {
        ...prev,
        items: newItems,
        totalItems: newItems.reduce((sum, item) => sum + item.quantity, 0),
        totalPrice: newItems.reduce((sum, item) => sum + (item.outfit.totalPrice * item.quantity), 0)
      };

      // Save to localStorage
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(updatedCart));
      return updatedCart;
    });
  };

  const removeFromCart = async (itemId: string) => {
    if (guestState.isGuest) {
      // For guests, use guest context
      removeFromGuestCart(itemId);

      setCart(prev => {
        const newItems = prev.items.filter(item => item.id !== itemId);
        return {
          ...prev,
          items: newItems,
          totalItems: newItems.reduce((sum, item) => sum + item.quantity, 0),
          totalPrice: newItems.reduce((sum, item) => sum + (item.outfit.totalPrice * item.quantity), 0)
        };
      });
      return;
    }

    if (user) {
      try {
        const { error } = await supabase
          .from('user_cart')
          .delete()
          .eq('id', itemId)
          .eq('user_id', user.id);

        if (error) throw error;
      } catch (err) {
        console.error('Failed to remove item from database cart:', err);
        // Continue with local storage fallback
      }
    }

    setCart(prev => {
      const newItems = prev.items.filter(item => item.id !== itemId);
      const updatedCart = {
        ...prev,
        items: newItems,
        totalItems: newItems.reduce((sum, item) => sum + item.quantity, 0),
        totalPrice: newItems.reduce((sum, item) => sum + (item.outfit.totalPrice * item.quantity), 0)
      };

      // Save to localStorage
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(updatedCart));
      return updatedCart;
    });
  };

  const updateQuantity = async (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      await removeFromCart(itemId);
      return;
    }

    if (guestState.isGuest) {
      // For guests, update local state
      setCart(prev => {
        const newItems = prev.items.map(item =>
          item.id === itemId ? { ...item, quantity } : item
        );
        return {
          ...prev,
          items: newItems,
          totalItems: newItems.reduce((sum, item) => sum + item.quantity, 0),
          totalPrice: newItems.reduce((sum, item) => sum + (item.outfit.totalPrice * item.quantity), 0)
        };
      });
      return;
    }

    if (user) {
      try {
        const { error } = await supabase
          .from('user_cart')
          .update({ quantity })
          .eq('id', itemId)
          .eq('user_id', user.id);

        if (error) throw error;
      } catch (err) {
        console.error('Failed to update quantity in database cart:', err);
        // Continue with local storage fallback
      }
    }

    setCart(prev => {
      const newItems = prev.items.map(item =>
        item.id === itemId ? { ...item, quantity } : item
      );
      const updatedCart = {
        ...prev,
        items: newItems,
        totalItems: newItems.reduce((sum, item) => sum + item.quantity, 0),
        totalPrice: newItems.reduce((sum, item) => sum + (item.outfit.totalPrice * item.quantity), 0)
      };

      // Save to localStorage
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(updatedCart));
      return updatedCart;
    });
  };

  const clearCart = async () => {
    if (guestState.isGuest) {
      // For guests, clear local state
      setCart(defaultCart);
      return;
    }

    if (user) {
      try {
        const { error } = await supabase
          .from('user_cart')
          .delete()
          .eq('user_id', user.id);

        if (error) throw error;
      } catch (err) {
        console.error('Failed to clear cart in database:', err);
        // Continue with local storage fallback
      }
    }

    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(defaultCart));
    setCart(defaultCart);
  };

  return {
    cart,
    loading,
    error,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    refetch: fetchCart
  };
}