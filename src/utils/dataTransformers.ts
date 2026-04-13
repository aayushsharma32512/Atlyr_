import { Outfit, OutfitItem, Occasion, ItemType, Silhouette } from '@/types';

// Database types for proper typing
interface DatabaseOutfit {
  id: string;
  name: string;
  category: string;
  gender?: 'male' | 'female' | 'unisex' | string | null;
  background_id?: string;
  fit?: string;
  feel?: string;
  word_association?: string;
  rating?: number;
  popularity?: number | null;
  created_at?: string | null;
  created_by?: string | null;
  occasion: {
    id: string;
    name: string;
    slug: string;
    background_url: string;
    description?: string;
  };
  top?: {
    id: string;
    type: string;
    brand: string;
    gender?: 'male' | 'female' | 'unisex' | string | null;
    product_name?: string | null;
    size: string;
    price: number;
    currency: string;
    image_url: string;
    description: string;
    color: string;
    color_group?: string | null;
    category_id?: string | null;
    fit?: string | null;
    feel?: string | null;
    placement_x?: number | null;
    placement_y?: number | null;
    image_length?: number | null;
  };
  bottom?: {
    id: string;
    type: string;
    brand: string;
    gender?: 'male' | 'female' | 'unisex' | string | null;
    product_name?: string | null;
    size: string;
    price: number;
    currency: string;
    image_url: string;
    description: string;
    color: string;
    color_group?: string | null;
    category_id?: string | null;
    fit?: string | null;
    feel?: string | null;
    placement_x?: number | null;
    placement_y?: number | null;
    image_length?: number | null;
  };
  shoes?: {
    id: string;
    type: string;
    brand: string;
    gender?: 'male' | 'female' | 'unisex' | string | null;
    product_name?: string | null;
    size: string;
    price: number;
    currency: string;
    image_url: string;
    description: string;
    color: string;
    color_group?: string | null;
    category_id?: string | null;
    fit?: string | null;
    feel?: string | null;
    placement_x?: number | null;
    placement_y?: number | null;
    image_length?: number | null;
  };
}

interface DatabaseProduct {
  id: string;
  type: string;
  brand: string;
  gender?: 'male' | 'female' | 'unisex' | string | null;
  product_name?: string | null;
  size: string;
  price: number;
  currency: string;
  image_url: string;
  description: string;
  color: string;
  color_group?: string | null;
  category_id?: string | null;
  fit?: string | null;
  feel?: string | null;
  placement_x?: number | null;
  placement_y?: number | null;
  image_length?: number | null;
}

interface DatabaseOccasion {
  id: string;
  name: string;
  slug: string;
  background_url: string;
  description?: string;
}

interface DatabaseSilhouette {
  id: string;
  name: string;
  image_url: string;
  description?: string;
}

// Centralized data transformers to eliminate duplication
export const dataTransformers = {
  // Transform database outfit to local format
  outfit: (dbOutfit: DatabaseOutfit): Outfit => {
    const items: OutfitItem[] = [
      dbOutfit.top && {
        id: dbOutfit.top.id,
        type: dbOutfit.top.type as ItemType,
        brand: dbOutfit.top.brand,
        gender: (dbOutfit.top.gender === 'male' || dbOutfit.top.gender === 'female' || dbOutfit.top.gender === 'unisex') ? dbOutfit.top.gender as 'male' | 'female' | 'unisex' : null,
        product_name: dbOutfit.top.product_name ?? null,
        size: dbOutfit.top.size,
        price: dbOutfit.top.price,
        currency: dbOutfit.top.currency,
        imageUrl: dbOutfit.top.image_url,
        description: dbOutfit.top.description,
        color: dbOutfit.top.color,
        color_group: dbOutfit.top.color_group ?? null,
        category_id: dbOutfit.top.category_id ?? null,
        fit: dbOutfit.top.fit ?? null,
        feel: dbOutfit.top.feel ?? null,
        placement_x: dbOutfit.top.placement_x,
        placement_y: dbOutfit.top.placement_y,
        image_length: dbOutfit.top.image_length ?? null
      },
      dbOutfit.bottom && {
        id: dbOutfit.bottom.id,
        type: dbOutfit.bottom.type as ItemType,
        brand: dbOutfit.bottom.brand,
        gender: (dbOutfit.bottom.gender === 'male' || dbOutfit.bottom.gender === 'female' || dbOutfit.bottom.gender === 'unisex') ? dbOutfit.bottom.gender as 'male' | 'female' | 'unisex' : null,
        product_name: dbOutfit.bottom.product_name ?? null,
        size: dbOutfit.bottom.size,
        price: dbOutfit.bottom.price,
        currency: dbOutfit.bottom.currency,
        imageUrl: dbOutfit.bottom.image_url,
        description: dbOutfit.bottom.description,
        color: dbOutfit.bottom.color,
        color_group: dbOutfit.bottom.color_group ?? null,
        category_id: dbOutfit.bottom.category_id ?? null,
        fit: dbOutfit.bottom.fit ?? null,
        feel: dbOutfit.bottom.feel ?? null,
        placement_x: dbOutfit.bottom.placement_x,
        placement_y: dbOutfit.bottom.placement_y,
        image_length: dbOutfit.bottom.image_length ?? null
      },
      dbOutfit.shoes && {
        id: dbOutfit.shoes.id,
        type: dbOutfit.shoes.type as ItemType,
        brand: dbOutfit.shoes.brand,
        gender: (dbOutfit.shoes.gender === 'male' || dbOutfit.shoes.gender === 'female' || dbOutfit.shoes.gender === 'unisex') ? dbOutfit.shoes.gender as 'male' | 'female' | 'unisex' : null,
        product_name: dbOutfit.shoes.product_name ?? null,
        size: dbOutfit.shoes.size,
        price: dbOutfit.shoes.price,
        currency: dbOutfit.shoes.currency,
        imageUrl: dbOutfit.shoes.image_url,
        description: dbOutfit.shoes.description,
        color: dbOutfit.shoes.color,
        color_group: dbOutfit.shoes.color_group ?? null,
        category_id: dbOutfit.shoes.category_id ?? null,
        fit: dbOutfit.shoes.fit ?? null,
        feel: dbOutfit.shoes.feel ?? null,
        placement_x: dbOutfit.shoes.placement_x,
        placement_y: dbOutfit.shoes.placement_y,
        image_length: dbOutfit.shoes.image_length ?? null
      }
    ].filter(Boolean) as OutfitItem[];

    // Calculate totalPrice and currency
    const totalPrice = items.reduce((sum, item) => sum + (item?.price || 0), 0);
    const currency = items[0]?.currency || 'INR';

    return {
      id: dbOutfit.id,
      name: dbOutfit.name,
      category: dbOutfit.category,
      gender: (dbOutfit.gender === 'male' || dbOutfit.gender === 'female' || dbOutfit.gender === 'unisex') ? dbOutfit.gender as 'male' | 'female' | 'unisex' : null,
      totalPrice: totalPrice,
      currency: currency,
      occasion: {
        id: dbOutfit.occasion.id,
        name: dbOutfit.occasion.name,
        slug: dbOutfit.occasion.slug,
        backgroundUrl: dbOutfit.occasion.background_url,
        description: dbOutfit.occasion.description || ''
      },
      backgroundId: dbOutfit.background_id,
      items: items,
      fit: dbOutfit.fit,
      feel: dbOutfit.feel,
      word_association: dbOutfit.word_association,
      rating: dbOutfit.rating,
      popularity: dbOutfit.popularity ?? null,
      created_at: dbOutfit.created_at ?? null,
      created_by: dbOutfit.created_by ?? null
    };
  },

  // Transform database product to local format
  product: (dbProduct: DatabaseProduct): OutfitItem => ({
    id: dbProduct.id,
    type: dbProduct.type as ItemType,
    brand: dbProduct.brand,
    gender: (dbProduct.gender === 'male' || dbProduct.gender === 'female' || dbProduct.gender === 'unisex') ? dbProduct.gender as 'male' | 'female' | 'unisex' : null,
    product_name: dbProduct.product_name ?? null,
    size: dbProduct.size,
    price: dbProduct.price,
    currency: dbProduct.currency,
    imageUrl: dbProduct.image_url,
    description: dbProduct.description,
    color: dbProduct.color,
    color_group: dbProduct.color_group ?? null,
    category_id: dbProduct.category_id ?? null,
    fit: dbProduct.fit ?? null,
    feel: dbProduct.feel ?? null,
    placement_x: dbProduct.placement_x,
    placement_y: dbProduct.placement_y,
    image_length: dbProduct.image_length ?? null
  }),

  // Transform database occasion to local format
  occasion: (dbOccasion: DatabaseOccasion): Occasion => ({
    id: dbOccasion.id,
    name: dbOccasion.name,
    slug: dbOccasion.slug,
    backgroundUrl: dbOccasion.background_url,
    description: dbOccasion.description || ''
  }),

  // Transform database silhouette to local format
  silhouette: (dbSilhouette: DatabaseSilhouette): Silhouette => ({
    id: dbSilhouette.id,
    name: dbSilhouette.name,
    imageUrl: dbSilhouette.image_url,
    description: dbSilhouette.description || ''
  })
}; 