import { useState, useEffect, useRef, useCallback } from 'react';
import { useMemo } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Search, 
  Loader2, 
  TrendingUp,
  Clock,
  SlidersHorizontal,
  X,
  Heart,
  Calendar,
  DollarSign,
  Tag,
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { OutfitCard } from '@/components/home/OutfitCard';
import { ProductCard } from '@/components/product/ProductCard';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useFavorites } from '@/hooks/useFavorites';
import { useOutfits } from '@/hooks/useOutfits';
import { useProducts } from '@/hooks/useProducts';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useVectorSearch } from '@/hooks/useVectorSearch';
import { Outfit, Product } from '@/types';
import { logInteraction, INTERACTION_WEIGHTS } from '@/utils/interactionLogger';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

interface SearchScreenProps {
  onOutfitSelect: (outfit: Outfit) => void;
}

const trendingSearches = [
  { term: 'Date Night', icon: '💕', count: '2.3k' },
  { term: 'Business Casual', icon: '💼', count: '1.8k' },
  { term: 'Weekend Vibes', icon: '🌟', count: '3.1k' },
  { term: 'Summer Ready', icon: '☀️', count: '2.7k' }
];

const quickFilters = {
  outfits: [
    { id: 'occasion', label: 'Occasion', icon: Calendar },
    { id: 'category', label: 'Category', icon: Tag },
    { id: 'fit', label: 'Fit', icon: Sparkles },
    { id: 'recent', label: 'Recent', icon: Clock }
  ],
  products: [
    { id: 'price', label: 'Price', icon: DollarSign },
    { id: 'brands', label: 'Brand', icon: Tag },
    { id: 'colorGroups', label: 'Color', icon: Sparkles },
    { id: 'sizes', label: 'Size', icon: Calendar }
  ]
} as const;

const RECENT_OUTFIT_KEY = 'recent_outfit_queries';
const RECENT_PRODUCT_KEY = 'recent_product_queries';

export function SearchScreen({ onOutfitSelect }: SearchScreenProps) {
  const [searchMode, setSearchMode] = useState<'outfits' | 'products'>('outfits');
  const [filteredOutfits, setFilteredOutfits] = useState<Outfit[]>([]);
  const [sortedProducts, setSortedProducts] = useState<Product[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const promptIntervalRef = useRef<number | null>(null);
  const [promptIndex, setPromptIndex] = useState(0);

  // Rotating prompt pools
  const outfitPrompts = [
    "Try: Old money office under ₹3k",
    "Try: Streetwear weekend neutral tones",
    "Try: Smart casual dinner in navy",
  ];
  const productPrompts = [
    "Try: White sneakers under ₹2k",
    "Try: Linen shirt relaxed fit",
    "Try: Black jeans slim fit",
  ];
  
  // Vector search state
  const [vectorSearchResults, setVectorSearchResults] = useState<{ 
    outfits: (Outfit & { similarityScore?: number })[]; 
    products: (Product & { similarityScore?: number })[] 
  }>({ outfits: [], products: [] });
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  
  // Independent search states for each tab
  const [outfitSearchQuery, setOutfitSearchQuery] = useState('');
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [outfitSearchInputValue, setOutfitSearchInputValue] = useState('');
  const [productSearchInputValue, setProductSearchInputValue] = useState('');
  
  // Current search values based on active tab
  const searchQuery = searchMode === 'outfits' ? outfitSearchQuery : productSearchQuery;
  const searchInputValue = searchMode === 'outfits' ? outfitSearchInputValue : productSearchInputValue;
  const [selectedSort, setSelectedSort] = useState<'popularity' | 'rating' | 'latest' | 'name' | 'price-low' | 'price-high'>('popularity');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [activeFilterType, setActiveFilterType] = useState<string>('category');
  const [selectedFilters, setSelectedFilters] = useState<{ category: Set<string>; occasion: Set<string>; fit: Set<string>; gender: Set<string>; }>({ category: new Set(), occasion: new Set(), fit: new Set(), gender: new Set() });
  const [draftFilters, setDraftFilters] = useState<{ category: Set<string>; occasion: Set<string>; fit: Set<string>; gender: Set<string>; }>({ category: new Set(), occasion: new Set(), fit: new Set(), gender: new Set() });
  // Gender segmented toggle: 'male' | 'all' | 'female'
  const [selectedGenderToggle, setSelectedGenderToggle] = useState<'male' | 'all' | 'female'>('all');
  // Product filters (draft/apply)
  const [productSelectedFilters, setProductSelectedFilters] = useState<{
    typeCategories: Set<string>;
    brands: Set<string>;
    genders: Set<string>;
    fits: Set<string>;
    feels: Set<string>;
    colorGroups: Set<string>;
    sizes: Set<string>;
    priceMin: number | null;
    priceMax: number | null;
  }>({ typeCategories: new Set(), brands: new Set(), genders: new Set(), fits: new Set(), feels: new Set(), colorGroups: new Set(), sizes: new Set(), priceMin: null, priceMax: null });
  const [productDraftFilters, setProductDraftFilters] = useState<{
    typeCategories: Set<string>;
    brands: Set<string>;
    genders: Set<string>;
    fits: Set<string>;
    feels: Set<string>;
    colorGroups: Set<string>;
    sizes: Set<string>;
    priceMin: number | null;
    priceMax: number | null;
  }>({ typeCategories: new Set(), brands: new Set(), genders: new Set(), fits: new Set(), feels: new Set(), colorGroups: new Set(), sizes: new Set(), priceMin: null, priceMax: null });
  const searchRef = useRef<HTMLInputElement>(null);
  const suggestionContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const filterSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Recent searches per tab (hydrated from localStorage)
  const [recentOutfitSearches, setRecentOutfitSearches] = useState<string[]>([]);
  const [recentProductSearches, setRecentProductSearches] = useState<string[]>([]);
  
  // Debounced vector search
  const vectorSearchTimeoutRef = useRef<NodeJS.Timeout>();
  
  const { toggleFavorite, isFavorite, favorites } = useFavorites();
  const { outfits, loading, error } = useOutfits();
  
  // Vector search hook
  const { searchOutfits, searchItems, loading: vectorLoading, error: vectorError } = useVectorSearch();

  // Hydrate recent searches from localStorage
  useEffect(() => {
    try {
      const outfit = JSON.parse(localStorage.getItem(RECENT_OUTFIT_KEY) || '[]');
      const prod = JSON.parse(localStorage.getItem(RECENT_PRODUCT_KEY) || '[]');
      if (Array.isArray(outfit)) setRecentOutfitSearches(outfit.filter(Boolean));
      if (Array.isArray(prod)) setRecentProductSearches(prod.filter(Boolean));
    } catch (e) {
      // ignore parse errors
    }
  }, []);

  const getActiveRecents = () => (searchMode === 'outfits' ? recentOutfitSearches : recentProductSearches);
  const setActiveRecents = (next: string[]) => {
    if (searchMode === 'outfits') {
      setRecentOutfitSearches(next);
      localStorage.setItem(RECENT_OUTFIT_KEY, JSON.stringify(next));
    } else {
      setRecentProductSearches(next);
      localStorage.setItem(RECENT_PRODUCT_KEY, JSON.stringify(next));
    }
  };

  const addRecent = (q: string) => {
    const query = q.trim();
    if (query.length < 3) return;
    const existing = getActiveRecents();
    const lower = query.toLowerCase();
    const deduped = existing.filter((w) => w && w.toLowerCase() !== lower);
    const next = [query, ...deduped].slice(0, 5);
    setActiveRecents(next);
  };

  const promptChips = useMemo(() => {
    const recents = (searchMode === 'outfits' ? recentOutfitSearches : recentProductSearches).map((term) => ({
      value: term,
      label: term,
      icon: '⏱',
      type: 'recent' as const
    }));
    const trending = trendingSearches.map((item) => ({
      value: item.term,
      label: item.term,
      icon: item.icon,
      type: 'trending' as const
    }));
    return [...recents, ...trending].slice(0, 6);
  }, [searchMode, recentOutfitSearches, recentProductSearches]);

  const activeQuickFilters = useMemo(() => {
    return searchMode === 'outfits' ? quickFilters.outfits : quickFilters.products;
  }, [searchMode]);

  const handlePromptChipClick = (term: string) => {
    if (!term) return;
    if (searchMode === 'outfits') {
      setOutfitSearchInputValue(term);
      setOutfitSearchQuery(term);
    } else {
      setProductSearchInputValue(term);
      setProductSearchQuery(term);
    }
    handleSearch(term);
    addRecent(term);
    setShowSuggestions(false);
    searchRef.current?.blur();
  };

  const handleQuickFilterTap = (id: string) => {
    if (id === 'recent') {
      setShowSuggestions(true);
      setIsSearchFocused(true);
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    if (searchMode === 'outfits') {
      switch (id) {
        case 'occasion':
          openFilter('occasion');
          break;
        case 'category':
          openFilter('category');
          break;
        case 'fit':
          openFilter('fit');
          break;
        default:
          openFilter();
          break;
      }
    } else {
      switch (id) {
        case 'price':
          openFilter('price');
          break;
        case 'brands':
          openFilter('brands');
          break;
        case 'colorGroups':
          openFilter('colorGroups');
          break;
        case 'sizes':
          openFilter('sizes');
          break;
        default:
          openFilter();
          break;
      }
    }
  };
  
  // Vector search function
  // Manual search submission function
  const handleManualSearch = useCallback(() => {
    const val = searchInputValue.trim();
    if (val.length >= 3) {
      handleSearch(val);
      addRecent(val);
      setShowSuggestions(false);
    } else if (val === '') {
      handleSearch('');
      setShowSuggestions(false);
    }
  }, [searchInputValue]);

  // Start/stop rotating prompts when input is empty and not focused
  useEffect(() => {
    const isEmpty = (searchInputValue || '').trim().length === 0;
    if (isEmpty && !isSearchFocused) {
      if (promptIntervalRef.current) window.clearInterval(promptIntervalRef.current);
      promptIntervalRef.current = window.setInterval(() => {
        setPromptIndex((idx) => (idx + 1) % (searchMode === 'outfits' ? outfitPrompts.length : productPrompts.length));
      }, 5000);
    } else {
      if (promptIntervalRef.current) {
        window.clearInterval(promptIntervalRef.current);
        promptIntervalRef.current = null;
      }
    }
    return () => {
      if (promptIntervalRef.current) window.clearInterval(promptIntervalRef.current);
    };
  }, [searchInputValue, isSearchFocused, searchMode]);

  const performVectorSearch = useCallback(async (query: string, mode: 'outfits' | 'products') => {
    if (!query.trim() || query.length < 3) {
      setVectorSearchResults({ outfits: [], products: [] });
      setIsVectorSearching(false);
      return;
    }
    
    setIsVectorSearching(true);
    
    try {
      const genderParam: 'male' | 'female' | undefined = selectedGenderToggle === 'all' ? undefined : selectedGenderToggle;
      if (mode === 'outfits') {
        // Build server-side filters payload for outfits
        const outfitFilters = {
          genders: (selectedFilters.gender.size > 0 ? Array.from(selectedFilters.gender) : undefined) as Array<'male' | 'female' | 'unisex'> | undefined,
          categories: (selectedFilters.category.size > 0 ? Array.from(selectedFilters.category) : undefined),
          occasions: (selectedFilters.occasion.size > 0 ? Array.from(selectedFilters.occasion) : undefined),
          fits: (selectedFilters.fit.size > 0 ? Array.from(selectedFilters.fit) : undefined),
        };
        const results = await searchOutfits(query, 30, genderParam, outfitFilters);
        setVectorSearchResults(prev => ({ ...prev, outfits: results }));
      } else {
        // Build server-side filters payload for products
        const explicitGenders = Array.from(productSelectedFilters.genders) as Array<'male'|'female'|'unisex'>;
        const productFilters = {
          genders: (explicitGenders.length > 0 ? explicitGenders : (selectedGenderToggle === 'all' ? undefined : [selectedGenderToggle, 'unisex'])) as Array<'male'|'female'|'unisex'> | undefined,
          typeCategories: (productSelectedFilters.typeCategories.size > 0 ? Array.from(productSelectedFilters.typeCategories) : undefined),
          brands: (productSelectedFilters.brands.size > 0 ? Array.from(productSelectedFilters.brands) : undefined),
          fits: (productSelectedFilters.fits.size > 0 ? Array.from(productSelectedFilters.fits) : undefined),
          feels: (productSelectedFilters.feels.size > 0 ? Array.from(productSelectedFilters.feels) : undefined),
          colorGroups: (productSelectedFilters.colorGroups.size > 0 ? Array.from(productSelectedFilters.colorGroups) : undefined),
          sizes: (productSelectedFilters.sizes.size > 0 ? Array.from(productSelectedFilters.sizes) : undefined),
          minPrice: productSelectedFilters.priceMin ?? undefined,
          maxPrice: productSelectedFilters.priceMax ?? undefined,
        };
        const results = await searchItems(query, 30, genderParam, productFilters);
        // Convert ProductWithSimilarity to Product for display
        const productResults = results.map(item => ({
          id: item.id,
          type: item.type,
          brand: item.brand,
          product_name: item.product_name || item.id,
          size: item.size,
          price: item.price,
          currency: item.currency,
          image_url: item.image_url,
          description: item.description,
          color: item.color,
          color_group: item.color_group,
          gender: item.gender,
          placement_y: item.placement_y,
          placement_x: item.placement_x,
          image_length: item.image_length,
          fit: item.fit,
          feel: item.feel,
          category_id: item.category_id,
          vibes: item.vibes,
          vibesArray: item.vibesArray,
          fitArray: item.fitArray,
          feelArray: item.feelArray,
          product_url: null,
          product_length: null,
          type_category: null,
          created_at: '',
          updated_at: '',
          similarityScore: item.similarityScore
        } as Product & { similarityScore?: number }));
        setVectorSearchResults(prev => ({ ...prev, products: productResults }));
      }
    } catch (error) {
      console.error('Vector search error:', error);
      // Fallbacks when vector search fails in production
      if (mode === 'outfits') {
        setVectorSearchResults(prev => ({ ...prev, outfits: [] }));
        // Fallback to traditional filtering + sorting on existing outfits
        if (outfits && outfits.length > 0) {
          let filtered = [...outfits];
          if (selectedFilters.category.size > 0) {
            filtered = filtered.filter(o => selectedFilters.category.has(o.category));
          }
          if (selectedFilters.occasion.size > 0) {
            filtered = filtered.filter(o => selectedFilters.occasion.has(o.occasion.name));
          }
          if (selectedFilters.fit.size > 0) {
            filtered = filtered.filter(o => o.fit && selectedFilters.fit.has(o.fit));
          }
          if (selectedFilters.gender.size > 0) {
            filtered = filtered.filter(o => o.gender && selectedFilters.gender.has(o.gender));
          }
          switch (selectedSort) {
            case 'popularity':
              filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
              break;
            case 'rating':
              filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
              break;
            case 'latest':
              filtered.sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());
              break;
            case 'name':
              filtered.sort((a, b) => a.name.localeCompare(b.name));
              break;
          }
          setFilteredOutfits(filtered);
          resetInfiniteScroll();
        }
      } else {
        setVectorSearchResults(prev => ({ ...prev, products: [] }));
        // Fallback to basic text search for products
        refetchProducts();
      }
    } finally {
      setIsVectorSearching(false);
    }
  }, [searchOutfits, searchItems, selectedGenderToggle]);
  
  // Product-specific hooks and state
  const productFilterParams = useMemo(() => {
    if (searchMode !== 'products') return {} as {
      genders?: Array<'male' | 'female' | 'unisex'>;
      typeCategories?: string[];
      brands?: string[];
      fits?: string[];
      feels?: string[];
      colorGroups?: string[];
      sizes?: string[];
      minPrice?: number;
      maxPrice?: number;
    };
    const params = {
      genders: Array.from(productSelectedFilters.genders) as Array<'male' | 'female' | 'unisex'>,
      typeCategories: Array.from(productSelectedFilters.typeCategories),
      brands: Array.from(productSelectedFilters.brands),
      fits: Array.from(productSelectedFilters.fits),
      feels: Array.from(productSelectedFilters.feels),
      colorGroups: Array.from(productSelectedFilters.colorGroups),
      sizes: Array.from(productSelectedFilters.sizes),
      minPrice: productSelectedFilters.priceMin ?? undefined,
      maxPrice: productSelectedFilters.priceMax ?? undefined,
    };

    return params;
    // Depend on the Sets so memo only updates when filters actually change
  }, [searchMode, productSelectedFilters.typeCategories, productSelectedFilters.brands, productSelectedFilters.genders, productSelectedFilters.fits, productSelectedFilters.feels, productSelectedFilters.colorGroups, productSelectedFilters.sizes, productSelectedFilters.priceMin, productSelectedFilters.priceMax]);

  // Compose genders for products: explicit filter panel takes precedence; otherwise use toggle
  const combinedProductGenders = useMemo(() => {
    const fromPanel = Array.from(productSelectedFilters.genders) as Array<'male'|'female'|'unisex'>;
    if (fromPanel.length > 0) return fromPanel;
    if (selectedGenderToggle === 'all') return undefined;
    return [selectedGenderToggle, 'unisex'] as Array<'male'|'female'|'unisex'>;
  }, [productSelectedFilters.genders, selectedGenderToggle]);

  const { 
    products, 
    loading: productsLoading, 
    error: productsError, 
    refetch: refetchProducts 
  } = useProducts({
    searchQuery: searchMode === 'products' ? searchQuery : undefined,
    limit: 50,
    genders: combinedProductGenders,
    // spread productFilterParams but ensure it doesn't override genders
    typeCategories: productFilterParams.typeCategories,
    brands: productFilterParams.brands,
    fits: productFilterParams.fits,
    feels: productFilterParams.feels,
    colorGroups: productFilterParams.colorGroups,
    sizes: productFilterParams.sizes,
    minPrice: productFilterParams.minPrice,
    maxPrice: productFilterParams.maxPrice,
  });

  // Initialize infinite scroll for search results
  const {
    visibleItems: displayedOutfits,
    loading: infiniteLoading,
    hasMore: hasMoreItems,
    lastElementRef,
    reset: resetInfiniteScroll
  } = useInfiniteScroll(filteredOutfits, {
    itemsPerPage: 8,
    threshold: 0.1
  });

  // Client-side infinite scroll for products (like outfits)
  const {
    visibleItems: displayedProducts,
    loading: productsInfiniteLoading,
    hasMore: productsHasMore,
    lastElementRef: productsLastElementRef,
    reset: resetProductsInfiniteScroll
  } = useInfiniteScroll(sortedProducts, {
    itemsPerPage: 8,
    threshold: 0.1
  });

  useEffect(() => {
    if (outfits && searchMode === 'outfits') {
      // Apply current sorting on initial load and whenever outfits change
      handleSearch(searchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfits, searchMode]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (vectorSearchTimeoutRef.current) {
        clearTimeout(vectorSearchTimeoutRef.current);
      }
    };
  }, []);

  // Re-apply current search with the updated sort whenever sort changes
  useEffect(() => {
    if (searchMode === 'outfits') {
      handleSearch(searchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSort, searchMode]);

  // Re-apply filtering/sorting whenever selectedFilters change
  useEffect(() => {
    handleSearch(searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilters]);

  // Effect: run the correct search path when gender toggle, mode, or query changes
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length >= 3) {
      performVectorSearch(q, searchMode);
    } else {
      if (searchMode === 'outfits') {
        handleSearch(searchQuery);
      } else {
        // Products are refetched via useProducts when genders option changes.
        // Avoid manual refetch to prevent double fetch flicker.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGenderToggle, searchMode, searchQuery]);

  // Close suggestions when clicking outside or pressing Escape (global)
  useEffect(() => {
    if (!showSuggestions) return;
    const onMouseDown = (e: MouseEvent) => {
      const container = suggestionContainerRef.current;
      if (container && !container.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSuggestions(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showSuggestions]);

  // Helper to sort by selected option
  const applySorting = (list: Outfit[]): Outfit[] => {
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (selectedSort) {
        case 'latest':
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        case 'name':
          return a.name.localeCompare(b.name);
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
        case 'popularity':
        default:
          return (b.popularity || 0) - (a.popularity || 0);
      }
    });
    return sorted;
  };

  // Filter and sort vector results for outfits to respect gender toggle and pills
  const processedVectorOutfits = useMemo(() => {
    let list = [...vectorSearchResults.outfits];
    // Header gender toggle (male/female includes unisex)
    if (selectedGenderToggle !== 'all') {
      list = list.filter(o => o.gender === selectedGenderToggle || o.gender === 'unisex');
    }
    // Pills: category, occasion, fit, gender
    if (selectedFilters.category.size > 0) {
      list = list.filter(o => selectedFilters.category.has(o.category));
    }
    if (selectedFilters.occasion.size > 0) {
      list = list.filter(o => selectedFilters.occasion.has(o.occasion.name));
    }
    if (selectedFilters.fit.size > 0) {
      list = list.filter(o => o.fit && selectedFilters.fit.has(o.fit));
    }
    if (selectedFilters.gender.size > 0) {
      list = list.filter(o => o.gender && selectedFilters.gender.has(o.gender));
    }
    return applySorting(list);
  }, [vectorSearchResults.outfits, selectedGenderToggle, selectedFilters, selectedSort, applySorting]);

  // Sort vector results for products
  const processedVectorProducts = useMemo(() => {
    const list = [...vectorSearchResults.products];
    switch (selectedSort) {
      case 'price-low':
        return list.sort((a, b) => a.price - b.price);
      case 'price-high':
        return list.sort((a, b) => b.price - a.price);
      default:
        return list;
    }
  }, [vectorSearchResults.products, selectedSort]);

  const handleSearch = (query: string) => {
    // Update the appropriate search query based on current tab
    if (searchMode === 'outfits') {
      setOutfitSearchQuery(query);
    } else {
      setProductSearchQuery(query);
    }
    setShowSuggestions(false);
    
    // Clear previous vector search timeout
    if (vectorSearchTimeoutRef.current) {
      clearTimeout(vectorSearchTimeoutRef.current);
    }
    
    // If query is empty, clear vector search results and use traditional search
    if (!query.trim()) {
      setVectorSearchResults({ outfits: [], products: [] });
      setIsVectorSearching(false);
      
      if (searchMode === 'outfits') {
        // Traditional outfit search logic
        if (!outfits) return;
        
        let filtered = [...outfits];
        
        // Apply filters
        if (selectedFilters.category.size > 0) {
          filtered = filtered.filter(outfit => selectedFilters.category.has(outfit.category));
        }
        if (selectedFilters.occasion.size > 0) {
          filtered = filtered.filter(outfit => selectedFilters.occasion.has(outfit.occasion.name));
        }
        if (selectedFilters.fit.size > 0) {
          filtered = filtered.filter(outfit => outfit.fit && selectedFilters.fit.has(outfit.fit));
        }
        // Gender toggle filter (male/female/unisex) in addition to pills
        const genderToggle = selectedGenderToggle;
        if (genderToggle !== 'all') {
          filtered = filtered.filter(outfit => outfit.gender === genderToggle || outfit.gender === 'unisex');
        }
        if (selectedFilters.gender.size > 0) {
          filtered = filtered.filter(outfit => outfit.gender && selectedFilters.gender.has(outfit.gender));
        }
        
        // Apply sorting
        switch (selectedSort) {
          case 'popularity':
            filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
            break;
          case 'rating':
            filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            break;
          case 'latest':
            filtered.sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());
            break;
          case 'name':
            filtered.sort((a, b) => a.name.localeCompare(b.name));
            break;
        }
        
        setFilteredOutfits(filtered);
        resetInfiniteScroll();
      } else {
        // Product search - handled by useProducts hook
        refetchProducts();
      }
      return;
    }
    
    // Vector search is triggered by effect (to avoid stale toggle state)
  };

  const personalized = outfits?.filter(outfit => 
    favorites.some(fav => fav.category === outfit.category)
  ).slice(0, 4) || [];

  // Build unique option lists
  const uniqueCategories = Array.from(new Set((outfits || []).map(o => o.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const uniqueOccasions = Array.from(new Set((outfits || []).map(o => o.occasion.name).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const uniqueFits = Array.from(new Set((outfits || []).map(o => o.fit).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));

  const toTitleCaseSlug = (slug: string) => slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const hasActiveFilters = selectedFilters.category.size > 0 || selectedFilters.occasion.size > 0 || selectedFilters.fit.size > 0 || selectedFilters.gender.size > 0;

  // Gender options
  const uniqueGenders = (() => {
    const g = Array.from(new Set((outfits || []).map(o => o.gender).filter(Boolean))) as string[];
    const defaults = ['male', 'female', 'unisex'];
    return (g.length > 0 ? Array.from(new Set([...g, ...defaults])) : defaults).sort((a, b) => a.localeCompare(b));
  })();

  // Helper: compute if an outfit matches given draft filters with OR logic within a section
  const outfitMatches = (o: Outfit, filters: { category: Set<string>; occasion: Set<string>; fit: Set<string>; gender: Set<string>; }) => {
    // Category OR within section
    if (filters.category.size > 0 && !filters.category.has(o.category)) return false;
    // Occasion OR within section
    if (filters.occasion.size > 0 && !filters.occasion.has(o.occasion.name)) return false;
    // Fit OR within section
    if (filters.fit.size > 0 && !(o.fit && filters.fit.has(o.fit))) return false;
    // Gender OR within section
    if (filters.gender.size > 0 && !(o.gender && filters.gender.has(o.gender))) return false;
    return true;
  };

  // Compute static counts per option (total items in each category, regardless of other selections)
  const getOptionCount = (section: 'category' | 'occasion' | 'fit' | 'gender', option: string) => {
    if (!outfits || outfits.length === 0) return 0;
    let count = 0;
    for (const o of outfits) {
      if (section === 'category' && o.category === option) count++;
      if (section === 'occasion' && o.occasion.name === option) count++;
      if (section === 'fit' && o.fit === option) count++;
      if (section === 'gender' && o.gender === option) count++;
    }
    return count;
  };

  // Compute dynamic count for draft selections (what will be shown when applied)
  const getDraftOutfitCount = () => {
    if (!outfits || outfits.length === 0) return 0;
    let count = 0;
    for (const o of outfits) {
      if (outfitMatches(o, draftFilters)) count++;
    }
    return count;
  };

  // ===== Products filter helpers =====
  // Unique product option lists (based on currently loaded products)
  const uniqueTypeCategories = Array.from(new Set((products || []).map(p => p.type_category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const uniqueBrands = Array.from(new Set((products || []).map(p => p.brand).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const uniqueProductGenders = Array.from(new Set((products || []).map(p => p.gender).filter(Boolean))) as string[];
  const uniqueProductFits = Array.from(new Set((products || []).map(p => p.fit).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const uniqueProductFeels = Array.from(new Set((products || []).map(p => p.feel).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const uniqueColorGroups = Array.from(new Set((products || []).map(p => p.color_group).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const uniqueSizes = Array.from(new Set((products || []).map(p => p.size).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const productMatches = (p: Product, filters: {
    typeCategories: Set<string>;
    brands: Set<string>;
    genders: Set<string>;
    fits: Set<string>;
    feels: Set<string>;
    colorGroups: Set<string>;
    sizes: Set<string>;
    priceMin: number | null;
    priceMax: number | null;
  }) => {
    if (filters.typeCategories.size > 0 && !(p.type_category && filters.typeCategories.has(p.type_category))) return false;
    if (filters.brands.size > 0 && !filters.brands.has(p.brand)) return false;
    if (filters.genders.size > 0 && !(p.gender && filters.genders.has(p.gender))) return false;
    if (filters.fits.size > 0 && !(p.fit && filters.fits.has(p.fit))) return false;
    if (filters.feels.size > 0 && !(p.feel && filters.feels.has(p.feel))) return false;
    if (filters.colorGroups.size > 0 && !(p.color_group && filters.colorGroups.has(p.color_group))) return false;
    if (filters.sizes.size > 0 && !filters.sizes.has(p.size)) return false;
    if (filters.priceMin != null && p.price < filters.priceMin) return false;
    if (filters.priceMax != null && p.price > filters.priceMax) return false;
    return true;
  };

  // Compute static counts per product option (total items in each category, regardless of other selections)
  const getProductOptionCount = (section: 'typeCategories' | 'brands' | 'genders' | 'fits' | 'feels' | 'colorGroups' | 'sizes', option: string) => {
    if (!products || products.length === 0) return 0;
    let count = 0;
    for (const p of products) {
      if (section === 'typeCategories' && p.type_category === option) count++;
      if (section === 'brands' && p.brand === option) count++;
      if (section === 'genders' && p.gender === option) count++;
      if (section === 'fits' && p.fit === option) count++;
      if (section === 'feels' && p.feel === option) count++;
      if (section === 'colorGroups' && p.color_group === option) count++;
      if (section === 'sizes' && p.size === option) count++;
    }
    return count;
  };

  // Compute dynamic count for product draft selections (what will be shown when applied)
  const getDraftProductCount = () => {
    if (!products || products.length === 0) return 0;
    let count = 0;
    for (const p of products) {
      if (productMatches(p, productDraftFilters)) count++;
    }
    return count;
  };

  // Sort products based on selected sort option
  const sortProducts = useCallback((productsToSort: Product[]) => {
    const sorted = [...productsToSort];
    switch (selectedSort) {
      case 'price-low':
        sorted.sort((a, b) => a.price - b.price);
        break;
      case 'price-high':
        sorted.sort((a, b) => b.price - a.price);
        break;
      default:
        // Default sorting (no change)
        break;
    }
    return sorted;
  }, [selectedSort]);

  // Update sorted products when products or sort changes
  useEffect(() => {
    if (products && products.length > 0) {
      setSortedProducts(sortProducts(products));
    }
  }, [products, sortProducts]);

  const openFilter = (focus?: string) => {
    if (focus) setActiveFilterType(focus);
    if (searchMode === 'outfits') {
      setDraftFilters({
        category: new Set(selectedFilters.category),
        occasion: new Set(selectedFilters.occasion),
        fit: new Set(selectedFilters.fit),
        gender: new Set(selectedFilters.gender)
      });
    } else {
      setProductDraftFilters({
        typeCategories: new Set(productSelectedFilters.typeCategories),
        brands: new Set(productSelectedFilters.brands),
        genders: new Set(productSelectedFilters.genders),
        fits: new Set(productSelectedFilters.fits),
        feels: new Set(productSelectedFilters.feels),
        colorGroups: new Set(productSelectedFilters.colorGroups),
        sizes: new Set(productSelectedFilters.sizes),
        priceMin: productSelectedFilters.priceMin,
        priceMax: productSelectedFilters.priceMax,
      });
    }
    setIsFilterOpen(true);
  };

  useEffect(() => {
    if (!isFilterOpen) return;
    const node = filterSectionRefs.current[activeFilterType];
    if (node) {
      requestAnimationFrame(() => {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [isFilterOpen, activeFilterType]);

  const toggleDraft = (type: 'category' | 'occasion' | 'fit' | 'gender', value: string) => {
    setDraftFilters(prev => {
      const next = { category: new Set(prev.category), occasion: new Set(prev.occasion), fit: new Set(prev.fit), gender: new Set(prev.gender) };
      const set = next[type];
      if (set.has(value)) set.delete(value); else set.add(value);
      return next;
    });
  };

  const removeDraftValue = (type: 'category' | 'occasion' | 'fit' | 'gender', value: string) => {
    setDraftFilters(prev => {
      const next = { category: new Set(prev.category), occasion: new Set(prev.occasion), fit: new Set(prev.fit), gender: new Set(prev.gender) };
      next[type].delete(value);
      return next;
    });
  };

  // Product draft toggles
  const toggleProductDraft = (type: 'typeCategories' | 'brands' | 'genders' | 'fits' | 'feels' | 'colorGroups' | 'sizes', value: string) => {
    setProductDraftFilters(prev => {
      const next = {
        typeCategories: new Set(prev.typeCategories),
        brands: new Set(prev.brands),
        genders: new Set(prev.genders),
        fits: new Set(prev.fits),
        feels: new Set(prev.feels),
        colorGroups: new Set(prev.colorGroups),
        sizes: new Set(prev.sizes),
        priceMin: prev.priceMin,
        priceMax: prev.priceMax,
      };
      const set = next[type] as Set<string>;
      if (set.has(value)) set.delete(value); else set.add(value);
      return next;
    });
  };

  const removeProductDraftValue = (type: 'typeCategories' | 'brands' | 'genders' | 'fits' | 'feels' | 'colorGroups' | 'sizes', value: string) => {
    setProductDraftFilters(prev => {
      const next = {
        typeCategories: new Set(prev.typeCategories),
        brands: new Set(prev.brands),
        genders: new Set(prev.genders),
        fits: new Set(prev.fits),
        feels: new Set(prev.feels),
        colorGroups: new Set(prev.colorGroups),
        sizes: new Set(prev.sizes),
        priceMin: prev.priceMin,
        priceMax: prev.priceMax,
      };
      (next[type] as Set<string>).delete(value);
      return next;
    });
  };

  const applyFiltersAndClose = () => {
    if (searchMode === 'outfits') {
    setSelectedFilters({
      category: new Set(draftFilters.category),
      occasion: new Set(draftFilters.occasion),
        fit: new Set(draftFilters.fit),
        gender: new Set(draftFilters.gender)
    });
    // Re-run search with same query and sort
    handleSearch(searchQuery);
    } else {
      // apply product filters and refetch
      setProductSelectedFilters({
        typeCategories: new Set(productDraftFilters.typeCategories),
        brands: new Set(productDraftFilters.brands),
        genders: new Set(productDraftFilters.genders),
        fits: new Set(productDraftFilters.fits),
        feels: new Set(productDraftFilters.feels),
        colorGroups: new Set(productDraftFilters.colorGroups),
        sizes: new Set(productDraftFilters.sizes),
        priceMin: productDraftFilters.priceMin,
        priceMax: productDraftFilters.priceMax,
      });
      refetchProducts();
    }
    setIsFilterOpen(false);
    // Reset pagination and scroll to top
    resetInfiniteScroll();
    resetProductsInfiniteScroll();
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  const clearAllFilters = () => {
    if (searchMode === 'outfits') {
      const empty = { category: new Set<string>(), occasion: new Set<string>(), fit: new Set<string>(), gender: new Set<string>() };
    setDraftFilters(empty);
    setSelectedFilters(empty);
    handleSearch(searchQuery);
    } else {
      const emptyP = { typeCategories: new Set<string>(), brands: new Set<string>(), genders: new Set<string>(), fits: new Set<string>(), feels: new Set<string>(), colorGroups: new Set<string>(), sizes: new Set<string>(), priceMin: null as number | null, priceMax: null as number | null };
      setProductDraftFilters(emptyP);
      setProductSelectedFilters(emptyP);
      refetchProducts();
    }
    setIsFilterOpen(false);
    resetInfiniteScroll();
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  const handleSearchModeChange = (mode: 'outfits' | 'products') => {
    setSearchMode(mode);
    
    // Maintain separate result sets - don't clear filteredOutfits
    resetInfiniteScroll();
    
    // Clear any active filters when switching modes
    const empty = { category: new Set<string>(), occasion: new Set<string>(), fit: new Set<string>(), gender: new Set<string>() };
    setSelectedFilters(empty);
    setDraftFilters(empty);
    
    // Check if the new tab has an active search query and perform search if needed
    const newTabSearchQuery = mode === 'outfits' ? outfitSearchQuery : productSearchQuery;
    if (newTabSearchQuery.trim().length >= 3) {
      performVectorSearch(newTabSearchQuery, mode);
    } else {
      // Ensure products are fetched when switching to products mode with no search
      if (mode === 'products') {
        refetchProducts();
      }
    }
  };

  // Handle product card click - ADDED NAVIGATION
  const handleProductClick = (product: Product) => {
    navigate(`/product/${product.id}`);
  };

  // Show full-screen loader for Outfits initial load, and for Products only on first fetch
  if (loading || (searchMode === 'products' && productsLoading && products.length === 0)) {
    return (
      <PageLayout>
        <div className="flex justify-center items-center h-64">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">
              {searchMode === 'outfits' ? 'Discovering outfits...' : 'Discovering products...'}
            </p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error || (searchMode === 'products' && productsError)) {
    return (
      <PageLayout>
        <Card className="card-premium">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
              <X className="w-8 h-8 text-destructive" />
            </div>
            <h3 className="font-medium mb-2">Something went wrong</h3>
            <p className="text-sm text-muted-foreground">
              Unable to load {searchMode === 'outfits' ? 'outfits' : 'products'}. Please try again later.
            </p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {/* Full Width Tab-Style Toggle - Sticky Top */}
      <div className="sticky top-0 z-10 bg-background border-b border-border/30 -mx-4">
        <SegmentedControl
          value={searchMode}
          onValueChange={handleSearchModeChange}
          className="w-full grid grid-cols-2 rounded-none border-0 bg-transparent"
          options={[
            { value: 'outfits', label: 'Outfits' },
            { value: 'products', label: 'Products' }
          ]}
        />
        {/* Gender Toggle moved to results header (beside Sort) */}
      </div>

      <div className="space-y-3 px-2">
        <div className="space-y-2">
          <div className="relative" ref={suggestionContainerRef}>
            <Input
              ref={searchRef}
              placeholder={(() => {
                const empty = (searchInputValue || '').trim().length === 0;
                if (!empty) return searchMode === 'outfits' ? "Search styles, occasions, moods..." : "Search products, brands, styles...";
                const pool = searchMode === 'outfits' ? outfitPrompts : productPrompts;
                return pool[promptIndex % pool.length] || (searchMode === 'outfits' ? "Search styles, occasions, moods..." : "Search products, brands, styles...");
              })()}
              value={searchInputValue}
              onChange={(e) => {
                if (searchMode === 'outfits') {
                  setOutfitSearchInputValue(e.target.value);
                } else {
                  setProductSearchInputValue(e.target.value);
                }
              }}
              onFocus={() => { setShowSuggestions(true); setIsSearchFocused(true); }}
              onBlur={() => setIsSearchFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleManualSearch();
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false);
                }
              }}
              className="pl-4 pr-20 h-11 rounded-full border border-border focus-visible:ring-1 focus-visible:ring-primary/40"
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
              {/* Search Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleManualSearch}
                disabled={searchInputValue.trim().length < 3}
                className={cn(
                  "h-7 px-2",
                  searchInputValue.trim().length < 3 && "opacity-50 cursor-not-allowed"
                )}
              >
                <Search className="w-3 h-3" />
              </Button>
              
              <Sheet open={isFilterOpen} onOpenChange={(open) => { if (!open) setIsFilterOpen(false); }}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="relative h-7 px-2 rounded-full border border-transparent hover:border-border/60"
                    onClick={() => openFilter()}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    {(() => {
                      const countOutfits = selectedFilters.category.size + selectedFilters.occasion.size + selectedFilters.fit.size + selectedFilters.gender.size;
                      const countProducts = Array.from(productSelectedFilters.typeCategories).length
                        + Array.from(productSelectedFilters.brands).length
                        + Array.from(productSelectedFilters.genders).length
                        + Array.from(productSelectedFilters.fits).length
                        + Array.from(productSelectedFilters.feels).length
                        + Array.from(productSelectedFilters.colorGroups).length
                        + Array.from(productSelectedFilters.sizes).length
                        + (productSelectedFilters.priceMin != null ? 1 : 0)
                        + (productSelectedFilters.priceMax != null ? 1 : 0);
                      const activeCount = searchMode === 'outfits' ? countOutfits : countProducts;
                      return activeCount > 0 ? (
                        <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full text-[10px] leading-none px-1.5 py-[2px]">
                          {activeCount}
                        </span>
                      ) : null;
                    })()}
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="bottom"
                  className="flex h-[78vh] w-full max-w-lg flex-col mx-auto rounded-t-3xl border border-border/40 bg-card/95 backdrop-blur-sm p-0 pb-[calc(env(safe-area-inset-bottom)+40px)]"
                >
                  <SheetHeader className="px-4 pt-4 pb-2">
                    <SheetTitle>Refine {searchMode === 'outfits' ? 'Outfits' : 'Products'}</SheetTitle>
                  </SheetHeader>
                  <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
                  {/* Selected pills bar */}
                  {searchMode === 'outfits' ? (
                  <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.5rem]">
                    {Array.from(draftFilters.category).map((val) => (
                      <span key={`cat-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-slate-100 text-slate-800 border-slate-200">
                        {toTitleCaseSlug(val)}
                        <button onClick={() => removeDraftValue('category', val)} className="opacity-70 hover:opacity-100">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {Array.from(draftFilters.occasion).map((val) => (
                      <span key={`occ-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-yellow-50 text-slate-800 border-yellow-100">
                        {toTitleCaseSlug(val)}
                        <button onClick={() => removeDraftValue('occasion', val)} className="opacity-70 hover:opacity-100">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {Array.from(draftFilters.fit).map((val) => (
                      <span key={`fit-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-emerald-50 text-slate-800 border-emerald-100">
                        {toTitleCaseSlug(val)}
                        <button onClick={() => removeDraftValue('fit', val)} className="opacity-70 hover:opacity-100">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                      {Array.from(draftFilters.gender).map((val) => (
                        <span key={`gender-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-blue-50 text-slate-800 border-blue-100">
                          {toTitleCaseSlug(val)}
                          <button onClick={() => removeDraftValue('gender', val)} className="opacity-70 hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {draftFilters.category.size === 0 && draftFilters.occasion.size === 0 && draftFilters.fit.size === 0 && draftFilters.gender.size === 0 && (
                      <span className="text-xs text-muted-foreground">No filters selected</span>
                    )}
                  </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.5rem]">
                      {Array.from(productDraftFilters.typeCategories).map((val) => (
                        <span key={`ptype-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-slate-100 text-slate-800 border-slate-200">
                          {toTitleCaseSlug(val)}
                          <button onClick={() => removeProductDraftValue('typeCategories', val)} className="opacity-70 hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {Array.from(productDraftFilters.brands).map((val) => (
                        <span key={`brand-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-slate-50 text-slate-800 border-slate-200">
                          {val}
                          <button onClick={() => removeProductDraftValue('brands', val)} className="opacity-70 hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {Array.from(productDraftFilters.genders).map((val) => (
                        <span key={`pgender-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-blue-50 text-slate-800 border-blue-100">
                          {toTitleCaseSlug(val)}
                          <button onClick={() => removeProductDraftValue('genders', val)} className="opacity-70 hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {Array.from(productDraftFilters.fits).map((val) => (
                        <span key={`pfit-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-emerald-50 text-slate-800 border-emerald-100">
                          {toTitleCaseSlug(val)}
                          <button onClick={() => removeProductDraftValue('fits', val)} className="opacity-70 hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {Array.from(productDraftFilters.feels).map((val) => (
                        <span key={`pfeel-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-amber-50 text-slate-800 border-amber-100">
                          {toTitleCaseSlug(val)}
                          <button onClick={() => removeProductDraftValue('feels', val)} className="opacity-70 hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {Array.from(productDraftFilters.colorGroups).map((val) => (
                        <span key={`pcolor-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-purple-50 text-slate-800 border-purple-100">
                          {toTitleCaseSlug(val)}
                          <button onClick={() => removeProductDraftValue('colorGroups', val)} className="opacity-70 hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {Array.from(productDraftFilters.sizes).map((val) => (
                        <span key={`psize-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-zinc-50 text-slate-800 border-zinc-200">
                          {val}
                          <button onClick={() => removeProductDraftValue('sizes', val)} className="opacity-70 hover:opacity-100">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {(productDraftFilters.typeCategories.size === 0 && productDraftFilters.brands.size === 0 && productDraftFilters.genders.size === 0 && productDraftFilters.fits.size === 0 && productDraftFilters.feels.size === 0 && productDraftFilters.colorGroups.size === 0 && productDraftFilters.sizes.size === 0 && productDraftFilters.priceMin == null && productDraftFilters.priceMax == null) && (
                        <span className="text-xs text-muted-foreground">No filters selected</span>
                      )}
                      {(productDraftFilters.priceMin != null || productDraftFilters.priceMax != null) && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-zinc-50 text-slate-800 border-zinc-200">
                          ₹{productDraftFilters.priceMin ?? 0} - ₹{productDraftFilters.priceMax ?? 20000}
                        </span>
                      )}
                    </div>
                  )}
                  {searchMode === 'outfits' ? (
                  <Accordion type="multiple" className="mt-1">
                    <AccordionItem value="category">
                      <AccordionTrigger>Category</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['category'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueCategories.map((opt) => {
                            const checked = draftFilters.category.has(opt);
                            const count = getOptionCount('category', opt);
                            const disabled = count === 0;
                      return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                          <Checkbox
                            checked={checked}
                                    onCheckedChange={() => !disabled && toggleDraft('category', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-slate-300 data-[state=checked]:bg-slate-600 data-[state=checked]:border-slate-600 data-[state=checked]:text-white`}
                          />
                          <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                        </label>
                      );
                    })}
                  </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="occasion">
                      <AccordionTrigger>Occasion</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['occasion'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueOccasions.map((opt) => {
                            const checked = draftFilters.occasion.has(opt);
                            const count = getOptionCount('occasion', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleDraft('occasion', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-yellow-200 data-[state=checked]:bg-yellow-600 data-[state=checked]:border-yellow-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="fit">
                      <AccordionTrigger>Fit</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['fit'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueFits.map((opt) => {
                            const checked = draftFilters.fit.has(opt);
                            const count = getOptionCount('fit', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleDraft('fit', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-emerald-200 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="gender">
                      <AccordionTrigger>Gender</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['gender'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueGenders.map((opt) => {
                            const checked = draftFilters.gender.has(opt);
                            const count = getOptionCount('gender', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleDraft('gender', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-blue-200 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                  ) : (
                  <Accordion type="multiple" className="mt-1">
                    <AccordionItem value="price">
                      <AccordionTrigger>Price</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Min</span>
                              <Input
                                type="number"
                                value={productDraftFilters.priceMin ?? ''}
                                placeholder="0"
                                onChange={(e) => {
                                  const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                                  setProductDraftFilters(prev => ({
                                    ...prev,
                                    priceMin: val,
                                    typeCategories: new Set(prev.typeCategories),
                                    brands: new Set(prev.brands),
                                    genders: new Set(prev.genders),
                                    fits: new Set(prev.fits),
                                    feels: new Set(prev.feels),
                                    colorGroups: new Set(prev.colorGroups),
                                    sizes: new Set(prev.sizes),
                                  }));
                                }}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Max</span>
                              <Input
                                type="number"
                                value={productDraftFilters.priceMax ?? ''}
                                placeholder="20000"
                                onChange={(e) => {
                                  const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                                  setProductDraftFilters(prev => ({
                                    ...prev,
                                    priceMax: val,
                                    typeCategories: new Set(prev.typeCategories),
                                    brands: new Set(prev.brands),
                                    genders: new Set(prev.genders),
                                    fits: new Set(prev.fits),
                                    feels: new Set(prev.feels),
                                    colorGroups: new Set(prev.colorGroups),
                                    sizes: new Set(prev.sizes),
                                  }));
                                }}
                              />
            </div>

            {/* Modifier chips row (Occasion, Fit, Budget) shown when input empty */}
            {searchInputValue.trim().length === 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto scrollbar-hide">
                {[{k:'Occasion',v:'date night'},{k:'Fit',v:'relaxed fit'},{k:'Budget',v:'under ₹3000'}].map(({k,v}) => (
                  <Button
                    key={k}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs rounded-full"
                    onClick={() => {
                      const combined = v;
                      if ((searchMode as string) === 'outfits') {
                        setOutfitSearchInputValue(combined);
                      } else if ((searchMode as string) === 'products') {
                        setProductSearchInputValue(combined);
                      }
                      if (combined.length >= 3) {
                        handleSearch(combined);
                        addRecent(combined);
                        setShowSuggestions(false);
                        searchRef.current?.blur();
                      }
                    }}
                  >
                    {k}: {v}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Active filters chip bar (always visible when filters selected) */}
        {(() => {
          const hasOutfitFilters = selectedFilters.category.size > 0 || selectedFilters.occasion.size > 0 || selectedFilters.fit.size > 0 || selectedFilters.gender.size > 0;
          const hasProductFilters = productSelectedFilters.typeCategories.size > 0 || productSelectedFilters.brands.size > 0 || productSelectedFilters.genders.size > 0 || productSelectedFilters.fits.size > 0 || productSelectedFilters.feels.size > 0 || productSelectedFilters.colorGroups.size > 0 || productSelectedFilters.sizes.size > 0 || productSelectedFilters.priceMin != null || productSelectedFilters.priceMax != null;
          const hasFilters = (searchMode as string) === 'outfits' ? hasOutfitFilters : hasProductFilters;
          if (!hasFilters) return null;
          
          const chips: Array<{label:string; onRemove: () => void}> = [];
          if ((searchMode as string) === 'outfits') {
            Array.from(selectedFilters.category).forEach((val) => chips.push({ label: `Category: ${toTitleCaseSlug(val)}`, onRemove: () => setSelectedFilters(prev => ({...prev, category: new Set(Array.from(prev.category).filter(v => v!==val))})) }));
            Array.from(selectedFilters.occasion).forEach((val) => chips.push({ label: `Occasion: ${toTitleCaseSlug(val)}`, onRemove: () => setSelectedFilters(prev => ({...prev, occasion: new Set(Array.from(prev.occasion).filter(v => v!==val))})) }));
            Array.from(selectedFilters.fit).forEach((val) => chips.push({ label: `Fit: ${toTitleCaseSlug(val)}`, onRemove: () => setSelectedFilters(prev => ({...prev, fit: new Set(Array.from(prev.fit).filter(v => v!==val))})) }));
            Array.from(selectedFilters.gender).forEach((val) => chips.push({ label: `Gender: ${toTitleCaseSlug(val)}`, onRemove: () => setSelectedFilters(prev => ({...prev, gender: new Set(Array.from(prev.gender).filter(v => v!==val))})) }));
          } else if (searchMode === 'products') {
            Array.from(productSelectedFilters.typeCategories).forEach((val) => chips.push({ label: `Type: ${toTitleCaseSlug(val)}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, typeCategories: new Set(Array.from(prev.typeCategories).filter(v => v!==val))})) }));
            Array.from(productSelectedFilters.brands).forEach((val) => chips.push({ label: `Brand: ${val}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, brands: new Set(Array.from(prev.brands).filter(v => v!==val))})) }));
            Array.from(productSelectedFilters.genders).forEach((val) => chips.push({ label: `Gender: ${val}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, genders: new Set(Array.from(prev.genders).filter(v => v!==val))})) }));
            Array.from(productSelectedFilters.fits).forEach((val) => chips.push({ label: `Fit: ${toTitleCaseSlug(val)}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, fits: new Set(Array.from(prev.fits).filter(v => v!==val))})) }));
            Array.from(productSelectedFilters.feels).forEach((val) => chips.push({ label: `Feel: ${toTitleCaseSlug(val)}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, feels: new Set(Array.from(prev.feels).filter(v => v!==val))})) }));
            Array.from(productSelectedFilters.colorGroups).forEach((val) => chips.push({ label: `Color: ${toTitleCaseSlug(val)}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, colorGroups: new Set(Array.from(prev.colorGroups).filter(v => v!==val))})) }));
            Array.from(productSelectedFilters.sizes).forEach((val) => chips.push({ label: `Size: ${val}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, sizes: new Set(Array.from(prev.sizes).filter(v => v!==val))})) }));
            if (productSelectedFilters.priceMin != null) chips.push({ label: `Min: ₹${productSelectedFilters.priceMin}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, priceMin: null})) });
            if (productSelectedFilters.priceMax != null) chips.push({ label: `Max: ₹${productSelectedFilters.priceMax}`, onRemove: () => setProductSelectedFilters(prev => ({...prev, priceMax: null})) });
          }
          
          return (
            <div className="-mt-1 flex gap-2 overflow-x-auto scrollbar-hide items-center">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs rounded-full"
                onClick={() => clearAllFilters()}
              >
                Clear all
              </Button>
              {chips.map((chip, idx) => (
                <span key={idx} className="chip chip-neutral flex-shrink-0">
                  {chip.label}
                  <button onClick={chip.onRemove} className="opacity-70 hover:opacity-100">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          );
        })()}
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="type_category">
                      <AccordionTrigger>Type Category</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['typeCategories'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueTypeCategories.map((opt) => {
                            const checked = productDraftFilters.typeCategories.has(opt);
                            const count = getProductOptionCount('typeCategories', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleProductDraft('typeCategories', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-slate-300 data-[state=checked]:bg-slate-600 data-[state=checked]:border-slate-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="brand">
                      <AccordionTrigger>Brand</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['brands'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueBrands.map((opt) => {
                            const checked = productDraftFilters.brands.has(opt);
                            const count = getProductOptionCount('brands', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleProductDraft('brands', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-slate-300 data-[state=checked]:bg-slate-600 data-[state=checked]:border-slate-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{opt}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="pgender">
                      <AccordionTrigger>Gender</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['genders'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {(uniqueProductGenders.length ? uniqueProductGenders : ['male','female','unisex']).map((opt) => {
                            const checked = productDraftFilters.genders.has(opt);
                            const count = getProductOptionCount('genders', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleProductDraft('genders', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-blue-200 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="pfit">
                      <AccordionTrigger>Fit</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['fits'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueProductFits.map((opt) => {
                            const checked = productDraftFilters.fits.has(opt);
                            const count = getProductOptionCount('fits', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleProductDraft('fits', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-emerald-200 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="pfeel">
                      <AccordionTrigger>Feel</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['feels'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueProductFeels.map((opt) => {
                            const checked = productDraftFilters.feels.has(opt);
                            const count = getProductOptionCount('feels', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleProductDraft('feels', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-amber-200 data-[state=checked]:bg-amber-600 data-[state=checked]:border-amber-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="pcolor_group">
                      <AccordionTrigger>Color Group</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['colorGroups'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueColorGroups.map((opt) => {
                            const checked = productDraftFilters.colorGroups.has(opt);
                            const count = getProductOptionCount('colorGroups', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleProductDraft('colorGroups', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-purple-200 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{toTitleCaseSlug(opt)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="psize">
                      <AccordionTrigger>Size</AccordionTrigger>
                      <AccordionContent>
                        <div
                          ref={(el) => { filterSectionRefs.current['sizes'] = el; }}
                          className="max-h-56 overflow-y-auto pr-1"
                        >
                          {uniqueSizes.map((opt) => {
                            const checked = productDraftFilters.sizes.has(opt);
                            const count = getProductOptionCount('sizes', opt);
                            const disabled = count === 0;
                            return (
                              <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => !disabled && toggleProductDraft('sizes', opt)}
                                    disabled={disabled}
                                    className={`h-4 w-4 border-zinc-200 data-[state=checked]:bg-zinc-600 data-[state=checked]:border-zinc-600 data-[state=checked]:text-white`}
                                  />
                                  <span className="text-sm">{opt}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{count}</span>
                              </label>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                  )}
                  </div>
                  <SheetFooter className="px-4 pb-4 space-y-2 sticky bottom-0 bg-card/95 backdrop-blur">
                    <div className="w-full text-center text-xs text-muted-foreground">
                      {searchMode === 'outfits' 
                        ? `Showing ${getDraftOutfitCount()} Outfits`
                        : `Showing ${getDraftProductCount()} Products`
                      }
                    </div>
                    <div className="grid w-full grid-cols-2 gap-2">
                      <Button variant="outline" onClick={clearAllFilters}>Clear all</Button>
                      <Button onClick={applyFiltersAndClose}>Apply</Button>
                    </div>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
              {searchInputValue && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (searchMode === 'outfits') {
                      setOutfitSearchInputValue('');
                    } else {
                      setProductSearchInputValue('');
                    }
                    handleSearch('');
                  }}
                  className="h-7 px-2"
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>

            {/* Search Suggestions Dropdown */}
            {showSuggestions && searchInputValue === '' && (
              <Card className="absolute top-full left-0 right-0 mt-1 z-50 shadow-lg border-border/50">
                <CardContent className="p-3">
                  {getActiveRecents().length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          Recent
                        </div>
                        <button
                          className="text-[11px] underline decoration-dotted hover:text-foreground"
                          onClick={() => {
                            setActiveRecents([]);
                            setShowSuggestions(false);
                          }}
                        >
                          Clear
                        </button>
                      </div>
                      {getActiveRecents().map((search) => (
                        <Button
                          key={search}
                          variant="ghost"
                          className="w-full justify-start h-8 text-sm"
                          onClick={() => {
                            if (searchMode === 'outfits') {
                              setOutfitSearchInputValue(search);
                            } else {
                              setProductSearchInputValue(search);
                            }
                            handleSearch(search);
                            addRecent(search);
                            setShowSuggestions(false);
                            searchRef.current?.blur();
                          }}
                        >
                          <Search className="w-3 h-3 mr-2" />
                          {search}
                        </Button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
        </div>
      </div>

      {/* <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2 scrollbar-hide">
        {promptChips.map((chip, idx) => (
          <Button
            key={`${chip.value}-${idx}`}
            variant="outline"
            size="sm"
            className="flex-shrink-0 h-8 rounded-full border-border/60 bg-background/80 text-xs"
            onClick={() => handlePromptChipClick(chip.value)}
          >
            <span className="mr-1 text-sm">{chip.icon}</span>
            {chip.label}
          </Button>
        ))}
      </div> */}

      {/* <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-3 scrollbar-hide">
        {activeQuickFilters.map((filter) => (
          <Button
            key={filter.id}
            variant="secondary"
            size="sm"
            className="flex items-center gap-2 h-8 rounded-full bg-muted/70 text-xs"
            onClick={() => handleQuickFilterTap(filter.id)}
          >
            <filter.icon className="w-3 h-3" />
            {filter.label}
          </Button>
        ))}
      </div> */}

      {/* Results Section */}
      {(searchQuery !== '' || (!isVectorSearching && (searchMode === 'outfits' ? filteredOutfits.length > 0 : true)) || hasActiveFilters || (searchQuery.trim().length >= 3 && (vectorSearchResults.outfits.length > 0 || vectorSearchResults.products.length > 0))) && (
        <div className="space-y-3">
            {/* Results Header with Sort */}
            <div className="flex items-center justify-end">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {searchMode === 'outfits' 
                    ? searchQuery.trim().length >= 3 
                      ? `${processedVectorOutfits.length} result${processedVectorOutfits.length !== 1 ? 's' : ''}`
                      : `${filteredOutfits.length} result${filteredOutfits.length !== 1 ? 's' : ''}`
                    : searchQuery.trim().length >= 3
                      ? `${processedVectorProducts.length} result${processedVectorProducts.length !== 1 ? 's' : ''}`
                      : `${products.length} result${products.length !== 1 ? 's' : ''}`
                  }
                </span>
                {/* Compact Gender Toggle beside Sort: All | M | F */}
                <div className="flex items-center">
                  <div className="inline-grid grid-cols-3 rounded-full border border-border overflow-hidden text-[11px] h-7">
                    <button
                      className={cn('px-2.5 py-1', selectedGenderToggle === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted/40')}
                      onClick={() => setSelectedGenderToggle('all')}
                    >
                      All
                    </button>
                    <button
                      className={cn('px-2.5 py-1 border-l border-r border-border', selectedGenderToggle === 'male' ? 'bg-primary text-primary-foreground' : 'bg-muted/40')}
                      onClick={() => setSelectedGenderToggle('male')}
                    >
                      M
                    </button>
                    <button
                      className={cn('px-2.5 py-1', selectedGenderToggle === 'female' ? 'bg-primary text-primary-foreground' : 'bg-muted/40')}
                      onClick={() => setSelectedGenderToggle('female')}
                    >
                      F
                    </button>
                  </div>
                </div>
                {(searchMode === 'outfits' || searchMode === 'products') && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        Sort: {selectedSort === 'popularity' ? 'Popularity' : selectedSort === 'rating' ? 'Rating' : selectedSort === 'latest' ? 'Latest' : selectedSort === 'name' ? 'Name (A-Z)' : selectedSort === 'price-low' ? 'Price: Low to High' : 'Price: High to Low'}
                        <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {searchMode === 'outfits' ? (
                        <>
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedSort('popularity');
                          handleSearch(searchQuery);
                        }}
                      >
                        Popularity
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedSort('rating');
                          handleSearch(searchQuery);
                        }}
                      >
                        Rating
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedSort('latest');
                          handleSearch(searchQuery);
                        }}
                      >
                        Latest
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedSort('name');
                          handleSearch(searchQuery);
                        }}
                      >
                        Name (A-Z)
                      </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedSort('price-low');
                            }}
                          >
                            Price: Low to High
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedSort('price-high');
                            }}
                          >
                            Price: High to Low
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Enhanced Search Results Grid - Mobile Optimized */}
            {searchMode === 'outfits' ? (
              // Show loading state when vector searching
              (isVectorSearching && searchQuery.trim().length >= 3) ? (
                <div className="flex justify-center items-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      Finding the best matches...
                    </p>
                  </div>
                </div>
              ) : // Show vector search results if available
              (searchQuery.trim().length >= 3 && processedVectorOutfits.length > 0) ? (
                <div className="grid grid-cols-2 gap-4 px-1">
                  {processedVectorOutfits.map((outfit, index) => (
                    <div 
                      key={`${outfit.id}-${index}`}
                      className="animate-fade-in"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <OutfitCard
                        outfit={outfit}
                        onClick={() => onOutfitSelect(outfit)}
                        onFavoriteToggle={() => {
                          const isCurrentlyFavorite = isFavorite(outfit.id);
                          toggleFavorite(outfit);
                          
                          logInteraction(
                            isCurrentlyFavorite ? 'favorite_remove' : 'favorite_add',
                            outfit.id,
                            outfit.category,
                            isCurrentlyFavorite ? INTERACTION_WEIGHTS.favorite_remove : INTERACTION_WEIGHTS.favorite_add,
                            {
                              outfit_name: outfit.name,
                              search_query: searchQuery,
                              source_view: 'search'
                            }
                          );
                        }}
                        isFavorite={isFavorite(outfit.id)}
                        maxCardWidth={200}
                        className="hover-lift hover-glow"
                      />
                    </div>
                  ))}
                </div>
              ) : // Show traditional results only when not vector searching
              (!isVectorSearching && filteredOutfits.length > 0) ? (
                <div className="grid grid-cols-2 gap-4 px-1">
                  {displayedOutfits.map((outfit, index) => (
                    <div 
                      key={`${outfit.id}-${index}`}
                      className="animate-fade-in"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <OutfitCard
                        outfit={outfit}
                        onClick={() => onOutfitSelect(outfit)}
                        onFavoriteToggle={() => {
                          const isCurrentlyFavorite = isFavorite(outfit.id);
                          toggleFavorite(outfit);
                          
                          logInteraction(
                            isCurrentlyFavorite ? 'favorite_remove' : 'favorite_add',
                            outfit.id,
                            outfit.category,
                            isCurrentlyFavorite ? INTERACTION_WEIGHTS.favorite_remove : INTERACTION_WEIGHTS.favorite_add,
                            {
                              outfit_name: outfit.name,
                              search_query: searchQuery,
                              source_view: 'search'
                            }
                          );
                        }}
                        isFavorite={isFavorite(outfit.id)}
                        maxCardWidth={200}
                        className="hover-lift hover-glow"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <Card className="card-premium">
                  <CardContent className="p-8 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
                      <Search className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      {searchQuery.trim().length >= 3 
                        ? 'No outfits found matching your search. Try different keywords or browse all styles.'
                        : 'No results found. Please try other filters'
                      }
                    </p>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        const empty = { category: new Set<string>(), occasion: new Set<string>(), fit: new Set<string>(), gender: new Set<string>() };
                        setDraftFilters(empty);
                        setSelectedFilters(empty);
                        handleSearch('');
                        resetInfiniteScroll();
                      }}
                    >
                      Clear Search
                    </Button>
                  </CardContent>
                </Card>
              )
            ) : (
              // Show loading state when vector searching
              (isVectorSearching && searchQuery.trim().length >= 3) ? (
                <div className="flex justify-center items-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      Finding the best matches...
                    </p>
                  </div>
                </div>
              ) : // Show vector search results if available
              (searchQuery.trim().length >= 3 && processedVectorProducts.length > 0) ? (
                <div className="grid grid-cols-2 gap-4 px-1">
                  {processedVectorProducts.map((product, index) => (
                    <div 
                      key={`${product.id}-${index}`}
                      className="animate-fade-in"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <ProductCard
                        product={product}
                        onClick={() => handleProductClick(product)}
                      />
                    </div>
                  ))}
                </div>
              ) : // Show traditional results only when not vector searching
              (!isVectorSearching && products.length > 0) ? (
                <div className="grid grid-cols-2 gap-4 px-1">
                  {displayedProducts.map((product, index) => (
                    <div 
                      key={`${product.id}-${index}`}
                      className="animate-fade-in"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <ProductCard
                        product={product}
                        onClick={() => handleProductClick(product)}
                      />
                    </div>
                  ))}
                  {productsHasMore && (
                    <div ref={productsLastElementRef} className="h-4" />
                  )}
                </div>
              ) : (
                <Card className="card-premium">
                  <CardContent className="p-8 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
                      <Search className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      {searchQuery.trim().length >= 3 
                        ? 'No products found matching your search. Try different keywords or browse all products.'
                        : 'No products found. Try a different search term.'
                      }
                    </p>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setProductSearchQuery('');
                        setProductSearchInputValue('');
                        refetchProducts();
                      }}
                    >
                      Clear Search
                    </Button>
                  </CardContent>
                </Card>
              )
            )}

            {/* Infinite Scroll Indicators - Only show when not vector searching */}
            {(!isVectorSearching && (infiniteLoading || (searchMode === 'products' && productsLoading))) && (
              <div className="flex justify-center pt-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">
                    {searchMode === 'outfits' ? 'Finding more styles...' : 'Finding more products...'}
                  </span>
                </div>
              </div>
            )}

            {(!isVectorSearching && (searchMode === 'outfits' ? !hasMoreItems && filteredOutfits.length > 8 : !productsHasMore && products.length > 0)) && (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  You've discovered all results!
                </p>
              </div>
            )}

            {hasMoreItems && searchMode === 'outfits' && (
              <div ref={lastElementRef} className="h-4" />
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
