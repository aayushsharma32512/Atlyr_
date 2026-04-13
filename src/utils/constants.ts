// Application constants to eliminate hardcoded values

export const APP_CONSTANTS = {
  // Currency
  DEFAULT_CURRENCY: 'INR',
  CURRENCY_LOCALE: 'en-IN',
  
  // Sizes
  AVAILABLE_SIZES: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  
  // Categories
  CATEGORIES: {
    FOR_YOU: 'for-you', // Page identifier (not a database category)
    DATE_READY: 'date-ready',
    OLD_MONEY: 'old-money',
    CASUAL_OUTING: 'casual-outing',
    CEO_CORE: 'ceo-core',
    STREETWEAR: 'streetwear'
  },
  
  // Item Types
  ITEM_TYPES: {
    TOP: 'top',
    BOTTOM: 'bottom',
    SHOES: 'shoes'
  },
  
  // Interaction weights
  INTERACTION_WEIGHTS: {
    favorite_add: 10,    // High weight for adding favorites
    favorite_remove: 2,  // Low weight for removing favorites
    studio_open: 8,      // High weight for studio opens
    cart_add: 9,         // High weight for cart additions
    share: 6,            // Medium weight for shares
    category_click: 3,   // Low weight for category clicks
    remix_click: 8,      // High weight for remix
    studio_time: 2,      // Low weight for time spent
    element_change: 5,   // Medium weight for changes
    search_query: 4,     // Medium weight for searches
    filter_usage: 3,     // Low weight for filters
    load_more: 2         // Low weight for pagination
  },
  
  // Storage keys
  STORAGE_KEYS: {
    FAVORITES: 'fashion-app-favorites',
    CART: 'fashion-app-cart'
  },
  
  // API endpoints
  ENDPOINTS: {
    OUTFITS: 'outfits',
    PRODUCTS: 'products',
    OCCASIONS: 'occasions',
    SILHOUETTES: 'silhouettes',
    CATEGORIES: 'categories',
    USER_FAVORITES: 'user_favorites',
    USER_CART: 'user_cart',
    USER_INTERACTIONS: 'user_interactions'
  },
  
  // UI constants
  UI: {
    ANIMATION_DURATION: 300,
    LOADING_DELAY: 1000,
    DEBOUNCE_DELAY: 300,
    MAX_HEIGHT: 600,
    FALLBACK_HEIGHT: 400,
    FALLBACK_WIDTH: 250
  },
  
  // Avatar selection constants
  AVATAR: {
    // Default hairstyles for each gender during face shape and skin tone selection
    DEFAULT_HAIRSTYLES: {
      male: 'military',
      female: 'bob'
    },
    // Custom sort order for skin tones (same for both genders)
    SKINTONE_SORT_ORDER: ['light', 'fair', 'medium', 'deep', 'dark'] as string[],
    // Custom sort order for hairstyles by gender
    HAIRSTYLE_SORT_ORDER: {
      male: ['military', 'parted', 'spikes', 'wet', 'wavy', 'long'] as string[],
      female: ['bob', 'pixie', 'straight', 'curly', 'layered', 'sideswept'] as string[]
    }
  },
  
  // Database field mappings
  DB_FIELDS: {
    IMAGE_URL: 'image_url',
    TOTAL_PRICE: 'total_price',
    BACKGROUND_ID: 'background_id',
    BACKGROUND_URL: 'background_url'
  }
} as const;

// Feature flags to toggle optional UI elements without touching backend behavior
export const FEATURE_FLAGS = {
  SHOW_SIMILARITY_BADGE: false,
} as const;

// Studio configuration
export const STUDIO_CONFIG = {
  // pill placement: 'side' to align left of avatar by slot midpoints, 'bottom' to show as a centered row beneath avatar
  PILL_PLACEMENT: 'side' as 'side' | 'bottom',
  // show a one-time swipe nudge hint (chevrons) on mobile
  SHOW_SWIPE_NUDGE: true,
} as const;

// Currency formatter utility
export const formatCurrency = (amount: number, currency = APP_CONSTANTS.DEFAULT_CURRENCY) => {
  return new Intl.NumberFormat(APP_CONSTANTS.CURRENCY_LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(Math.round(amount));
};

// Price formatting utility for Indian Rupees
export function formatINR(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

// Category utilities
export const getCategoryDisplayName = (category: string) => {
  const displayNames: Record<string, string> = {
    [APP_CONSTANTS.CATEGORIES.FOR_YOU]: 'For You', // Page identifier
    [APP_CONSTANTS.CATEGORIES.DATE_READY]: 'Date Ready',
    [APP_CONSTANTS.CATEGORIES.OLD_MONEY]: 'Old Money',
    [APP_CONSTANTS.CATEGORIES.CASUAL_OUTING]: 'Casual Outing',
    [APP_CONSTANTS.CATEGORIES.CEO_CORE]: 'CEO Core',
    [APP_CONSTANTS.CATEGORIES.STREETWEAR]: 'Streetwear'
  };
  return displayNames[category] || category;
};

// Avatar sorting utilities
export const sortByCustomOrder = <T extends { id: string }>(
  items: T[],
  customOrder: string[]
): T[] => {
  return [...items].sort((a, b) => {
    const aIndex = customOrder.indexOf(a.id);
    const bIndex = customOrder.indexOf(b.id);
    
    // If both items are in the custom order, sort by their position
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    
    // If only one item is in the custom order, prioritize it
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    
    // If neither item is in the custom order, sort alphabetically
    return a.id.localeCompare(b.id);
  });
};

export const getDefaultHairstyle = (gender: string): string => {
  return APP_CONSTANTS.AVATAR.DEFAULT_HAIRSTYLES[gender as keyof typeof APP_CONSTANTS.AVATAR.DEFAULT_HAIRSTYLES] || 'military';
};

export const getHairstyleSortOrder = (gender: string): string[] => {
  return APP_CONSTANTS.AVATAR.HAIRSTYLE_SORT_ORDER[gender as keyof typeof APP_CONSTANTS.AVATAR.HAIRSTYLE_SORT_ORDER] || APP_CONSTANTS.AVATAR.HAIRSTYLE_SORT_ORDER.male;
};

// Size utilities
export const isValidSize = (size: string) => {
  return APP_CONSTANTS.AVAILABLE_SIZES.includes(size as (typeof APP_CONSTANTS.AVAILABLE_SIZES)[number]);
}; 
