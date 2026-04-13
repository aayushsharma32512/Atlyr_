// Category color mapping for consistent chip styling across outfit cards
export const CATEGORY_COLORS = {
  'for-you': {
    bg: 'bg-gradient-to-r from-purple-100 to-pink-100',
    text: 'text-purple-800',
    border: 'border-purple-200'
  },
  'casual-outing': {
    bg: 'bg-gradient-to-r from-blue-100 to-cyan-100',
    text: 'text-blue-800',
    border: 'border-blue-200'
  },
  'ceo-core': {
    bg: 'bg-gradient-to-r from-slate-100 to-gray-100',
    text: 'text-slate-800',
    border: 'border-slate-200'
  },
  'date-ready': {
    bg: 'bg-gradient-to-r from-rose-100 to-pink-100',
    text: 'text-rose-800',
    border: 'border-rose-200'
  },
  'old-money': {
    bg: 'bg-gradient-to-r from-amber-100 to-yellow-100',
    text: 'text-amber-800',
    border: 'border-amber-200'
  },
  'streetwear': {
    bg: 'bg-gradient-to-r from-emerald-100 to-green-100',
    text: 'text-emerald-800',
    border: 'border-emerald-200'
  },
  'minimalist': {
    bg: 'bg-gradient-to-r from-neutral-100 to-stone-100',
    text: 'text-neutral-800',
    border: 'border-neutral-200'
  },
  'vintage': {
    bg: 'bg-gradient-to-r from-orange-100 to-amber-100',
    text: 'text-orange-800',
    border: 'border-orange-200'
  },
  'athleisure': {
    bg: 'bg-gradient-to-r from-indigo-100 to-purple-100',
    text: 'text-indigo-800',
    border: 'border-indigo-200'
  },
  'formal': {
    bg: 'bg-gradient-to-r from-slate-100 to-gray-100',
    text: 'text-slate-800',
    border: 'border-slate-200'
  }
} as const;

// Neutral colors for fit and feel chips
export const NEUTRAL_CHIP_STYLES = {
  bg: 'bg-gray-50',
  text: 'text-gray-700',
  border: 'border-gray-200'
};

// Helper function to get category colors
export function getCategoryColors(categorySlug: string) {
  return CATEGORY_COLORS[categorySlug as keyof typeof CATEGORY_COLORS] || {
    bg: 'bg-gray-100',
    text: 'text-gray-800',
    border: 'border-gray-200'
  };
}

// Helper function to format category display name
export function formatCategoryName(categorySlug: string): string {
  const displayNames: Record<string, string> = {
    'for-you': 'For You',
    'casual-outing': 'Casual Outing',
    'ceo-core': 'CEO Core',
    'date-ready': 'Date Ready',
    'old-money': 'Old Money',
    'streetwear': 'Streetwear',
    'minimalist': 'Minimalist',
    'vintage': 'Vintage',
    'athleisure': 'Athleisure',
    'formal': 'Formal'
  };
  
  return displayNames[categorySlug] || categorySlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
