export type ItemType = 'top' | 'bottom' | 'shoes' | 'accessory' | 'occasion';

// Product-related interfaces for search and description pages
export interface ProductImage {
  id: string;
  product_id: string;
  kind: 'flatlay' | 'model' | 'detail';
  sort_order: number;
  is_primary: boolean;
  url: string;
  gender: 'male' | 'female' | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Product {
  id: string;
  brand: string;
  product_name: string | null;
  price: number;
  currency: string;
  description: string;
  color: string;
  color_group: string | null;
  gender: 'male' | 'female' | 'unisex' | null;
  size: string;
  type: ItemType;
  category_id: string | null;
  vibes: string | null;
  fit: string | null;
  feel: string | null;
  image_url: string; // Legacy single image URL
  product_url: string | null;
  placement_x: number | null;
  placement_y: number | null;
  image_length: number | null;
  product_length: number | null;
  type_category: string | null;
  created_at: string;
  updated_at: string;
  // Computed fields for UI
  vibesArray?: string[];
  fitArray?: string[];
  feelArray?: string[];
}

export interface OutfitItem {
  id: string;
  type: ItemType;
  brand: string;
  product_name?: string | null;
  size: string;
  price: number;
  currency: string;
  imageUrl: string;
  productUrl?: string | null;
  description: string;
  color: string;
  color_group?: string | null;
  gender?: 'male' | 'female' | 'unisex' | null; // Product gender targeting
  placement_y?: number | null; // Database placement_y value
  placement_x?: number | null; // Database placement_x value
  image_length?: number | null; // Product image length in centimeters for scaling
  fit?: string | null; // Product fit from database
  feel?: string | null; // Product feel from database
  category_id?: string | null; // Product category id from database
  type_category?: string | null; // Product type_category (e.g., tops, bottoms, shoes)
  // Additional fields for expanded state
  sizeOptions?: string[]; // Available sizes (mock data)
  colorSwatches?: string[]; // Available colors (mock data)
  material?: string; // Material type (mock data)
  rating?: number; // Product rating (mock data)
}

export interface Occasion {
  id: string;
  name: string;
  slug: string;
  backgroundUrl: string;
  description: string;
}

export interface Outfit {
  id: string;
  name: string;
  category: string;
  totalPrice: number;
  currency: string;
  occasion: Occasion;
  backgroundId?: string; // Optional selected background URL
  items: OutfitItem[];
  gender?: 'male' | 'female' | 'unisex' | null; // Outfit gender targeting
  fit?: string | null;
  feel?: string | null;
  vibes?: string | null;
  word_association?: string | null;
  rating?: number; // Outfit rating from database
  popularity?: number | null; // Popularity score from database
  created_at?: string | null; // Creation timestamp
  created_by?: string | null; // Creator name from database
  user_id?: string | null; // Owner user id (if any)
}

export interface CartItem {
  id: string;
  outfit: Outfit;
  selectedSizes: { [itemId: string]: string };
  quantity: number;
  addedAt: string;
}

export interface Cart {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
  currency: string;
}

export interface Order {
  id: string;
  items: CartItem[];
  totalPrice: number;
  currency: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: string;
  deliveryAddress: string;
  paymentMethod: string;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'upi' | 'wallet';
  name: string;
  last4?: string;
  brand?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
}

export interface Silhouette {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
}
