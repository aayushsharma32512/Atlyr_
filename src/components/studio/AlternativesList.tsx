import { useRef, useState, useMemo, useCallback } from 'react';
import { X, MessageSquare, Send, ChevronUp, ChevronDown, Star, Ruler, Truck, RefreshCw, Shirt, Users, Footprints, ShoppingBag, Palette, Circle, Square, Triangle, SlidersHorizontal, ChevronRight, Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OutfitItem, ItemType } from '@/types';
import { ItemCard } from './ItemCard';
import { EnhancedProductCard } from './EnhancedProductCard';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ProductFiltersPanel, { ProductFilterState } from '@/components/product/ProductFiltersPanel';
// Removed local background service - now using database occasions
import { useOccasions } from '@/hooks/useOccasions';
import { useVectorSearch } from '@/hooks/useVectorSearch';
import { Occasion } from '@/types';
import { formatCurrency } from '@/utils/constants';

// Category icons for compressed state
const getCategoryIcon = (type: string) => {
  switch (type) {
    case 'top': return <Shirt className="w-5 h-5 text-foreground" />;
    case 'bottom': return <Square className="w-5 h-5 text-foreground" />;
    case 'shoes': return <Circle className="w-5 h-5 text-foreground" />;
    case 'accessory': return <Triangle className="w-5 h-5 text-foreground" />;
    case 'occasion': return <Palette className="w-5 h-5 text-foreground" />;
    default: return <Shirt className="w-5 h-5 text-foreground" />;
  }
};

// Convert product ID to sentence case (first letter uppercase, rest lowercase)
const toSentenceCase = (value: string | undefined) => {
  if (!value) return '';
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

// Using product id as title; no sentence-case helper needed

interface AlternativesListProps {
  alternatives: OutfitItem[];
  selectedItem: OutfitItem;
  currentOutfitItem?: OutfitItem; // The item from the current outfit for the selected type
  onItemSelect: (item: OutfitItem) => void;
  onClose: () => void;
  isVisible: boolean;
  onOccasionSelect?: (occasion: Occasion) => void;
  filterMode: 'alternate' | 'similar' | 'favorites' | 'wardrobe' | 'all';
  onFilterModeChange: (mode: 'alternate' | 'similar' | 'favorites' | 'wardrobe' | 'all') => void;
  outfitGender?: 'male' | 'female';
  // New: allow switching the item type directly in the panel
  availableTypes?: ItemType[]; // types to show in control (will be ignored in favor of full set top/bottom/shoes/occasion)
  currentType?: 'top' | 'bottom' | 'shoes' | 'occasion';
  onTypeChange?: (type: 'top' | 'bottom' | 'shoes' | 'occasion') => void;
  // New: present types in the current outfit (to show Add vs Remove)
  presentTypes?: ItemType[];
  onRemoveType?: (type: 'top' | 'bottom' | 'shoes') => void;
}

export function AlternativesList({ alternatives, selectedItem, currentOutfitItem, onItemSelect, onClose, isVisible, onOccasionSelect, filterMode, onFilterModeChange, outfitGender, availableTypes = ['top','bottom','shoes'], currentType, onTypeChange, presentTypes = ['top','bottom','shoes'], onRemoveType }: AlternativesListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [alternateSearchQuery, setAlternateSearchQuery] = useState('');
  const [isCurrentSelectionExpanded, setIsCurrentSelectionExpanded] = useState(false);
  const [selectedSort, setSelectedSort] = useState<'price-low' | 'price-high'>('price-low');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  
  // Search state management
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<OutfitItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  // Draft/apply filters using shared product filter shape
  const [selectedFilters, setSelectedFilters] = useState<ProductFilterState>({
    typeCategories: new Set<string>(),
    brands: new Set<string>(),
    genders: new Set<string>(),
    fits: new Set<string>(),
    feels: new Set<string>(),
    colorGroups: new Set<string>(),
    sizes: new Set<string>(),
    priceMin: null,
    priceMax: null,
  });
  const [draftFilters, setDraftFilters] = useState<ProductFilterState>({
    typeCategories: new Set<string>(),
    brands: new Set<string>(),
    genders: new Set<string>(),
    fits: new Set<string>(),
    feels: new Set<string>(),
    colorGroups: new Set<string>(),
    sizes: new Set<string>(),
    priceMin: null,
    priceMax: null,
  });
  const expandedCardRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  // Use currentOutfitItem if available, otherwise fall back to selectedItem
  const displayItem = currentOutfitItem || selectedItem;
  const isOccasionType = (currentType || displayItem.type) === 'occasion';
  
  // Use database occasions instead of local generation
  const { occasions, loading: occasionsLoading } = useOccasions();
  
  // Vector search hook
  const { searchItemsByCategory, loading: vectorSearchLoading } = useVectorSearch();

  // Helper function to get panel title based on filter mode
  const getPanelTitle = (itemType: string, mode: string) => {
    if (isOccasionType) return 'Background Themes';
    
    const itemTypeText = itemType === 'top' ? 'Topwear' : 
                        itemType === 'bottom' ? 'Bottomwear' : 'Footwear';
    
    // Always return just the item type, regardless of filter mode
    return itemTypeText;
  };

  // Search handlers
  const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setAlternateSearchQuery(query);
    
    // Clear search results if query is empty
    if (!query.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      setIsSearching(false);
    }
  }, []);

  const handleSearchSubmit = useCallback(async () => {
    const query = alternateSearchQuery.trim();
    
    // Minimum character validation (3+ characters like products mode)
    if (query.length < 3) {
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    
    try {
      // Search for items pre-filtered by the current item type (category-aware)
      const filteredResults = await searchItemsByCategory(query, displayItem.type, 20, outfitGender);
      
      // Transform ProductWithSimilarity to OutfitItem format
      const transformedResults: OutfitItem[] = filteredResults.map(item => ({
        id: item.id,
        type: item.type,
        brand: item.brand,
        product_name: item.product_name || null,
        size: item.size,
        price: item.price,
        currency: item.currency,
        imageUrl: item.image_url,
        description: item.description,
        color: item.color,
        color_group: item.color_group || null,
        gender: (item.gender === 'male' || item.gender === 'female' || item.gender === 'unisex') ? item.gender : null,
        placement_y: item.placement_y || null,
        placement_x: item.placement_x || null,
        image_length: item.image_length || null,
        fit: item.fit || null,
        feel: item.feel || null,
        category_id: item.category_id || null,
        vibes: item.vibes || null,
        vibesArray: item.vibesArray || null,
        fitArray: item.fitArray || null,
        feelArray: item.feelArray || null,
        type_category: item.type === 'top' ? 'tops' : item.type === 'bottom' ? 'bottoms' : 'shoes'
      }));
      
      setSearchResults(transformedResults);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [alternateSearchQuery, selectedItem.type, outfitGender, searchItemsByCategory]);

  const handleSearchClear = useCallback(() => {
    setAlternateSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    setIsSearching(false);
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchSubmit();
    }
  }, [handleSearchSubmit]);

  const filteredAlternatives = useMemo(() => {
    return alternatives.filter(item =>
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.color.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [alternatives, searchQuery]);

  const sortedAlternatives = useMemo(() => {
    const list = [...filteredAlternatives];
    if (selectedSort === 'price-low') {
      list.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (selectedSort === 'price-high') {
      list.sort((a, b) => (b.price || 0) - (a.price || 0));
    }
    return list;
  }, [filteredAlternatives, selectedSort]);

  // Sort search results by selected price order as well
  const sortedSearchResults = useMemo(() => {
    const list = [...searchResults];
    if (selectedSort === 'price-low') {
      list.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (selectedSort === 'price-high') {
      list.sort((a, b) => (b.price || 0) - (a.price || 0));
    }
    return list;
  }, [searchResults, selectedSort]);

  // Active base data that powers the grid (search results when present, else alternatives)
  const activeBaseData = useMemo(() => (
    hasSearched ? sortedSearchResults : sortedAlternatives
  ), [hasSearched, sortedSearchResults, sortedAlternatives]);

  // Build filter options from the same dataset the grid uses (unified source)
  const filterItems = useMemo(() => activeBaseData, [activeBaseData]);

  // Apply selected filters to sorted list
  const panelProducts = useMemo(() => {
    // Determine the base data source: search results or normal alternatives
    const baseData = hasSearched ? sortedSearchResults : sortedAlternatives;
    
    const minP = selectedFilters.priceMin;
    const maxP = selectedFilters.priceMax;
    return baseData.filter(p => {
      // Gender baseline: if no explicit gender selected, default to outfitGender or unisex
      if (outfitGender && selectedFilters.genders.size === 0) {
        if (!(p.gender === outfitGender || p.gender === 'unisex')) return false;
      }
      // type category (derived when needed in ProductFiltersPanel)
      if (selectedFilters.typeCategories.size > 0) {
        const cat = (p as any).type_category ?? (p.type === 'top' ? 'tops' : p.type === 'bottom' ? 'bottoms' : p.type === 'shoes' ? 'shoes' : p.type === 'accessory' ? 'accessories' : null);
        if (!(cat && selectedFilters.typeCategories.has(cat))) return false;
      }
      if (selectedFilters.brands.size > 0 && !selectedFilters.brands.has(p.brand)) return false;
      if (selectedFilters.genders.size > 0 && !(p.gender && selectedFilters.genders.has(p.gender))) return false;
      if (selectedFilters.fits.size > 0 && !(p.fit && selectedFilters.fits.has(p.fit))) return false;
      if (selectedFilters.feels.size > 0 && !(p.feel && selectedFilters.feels.has(p.feel))) return false;
      if (selectedFilters.colorGroups.size > 0 && !(p.color_group && selectedFilters.colorGroups.has(p.color_group))) return false;
      if (selectedFilters.sizes.size > 0 && !selectedFilters.sizes.has(p.size)) return false;
      if (minP != null && p.price < minP) return false;
      if (maxP != null && p.price > maxP) return false;
      return true;
    });
  }, [hasSearched, sortedSearchResults, sortedAlternatives, selectedFilters, outfitGender]);

  const openFilters = () => {
    setDraftFilters({
      typeCategories: new Set(selectedFilters.typeCategories),
      brands: new Set(selectedFilters.brands),
      genders: new Set(selectedFilters.genders),
      fits: new Set(selectedFilters.fits),
      feels: new Set(selectedFilters.feels),
      colorGroups: new Set(selectedFilters.colorGroups),
      sizes: new Set(selectedFilters.sizes),
      priceMin: selectedFilters.priceMin,
      priceMax: selectedFilters.priceMax,
    });
    setIsFilterOpen(true);
  };
  const applyFilters = () => {
    setSelectedFilters({
      typeCategories: new Set(draftFilters.typeCategories),
      brands: new Set(draftFilters.brands),
      genders: new Set(draftFilters.genders),
      fits: new Set(draftFilters.fits),
      feels: new Set(draftFilters.feels),
      colorGroups: new Set(draftFilters.colorGroups),
      sizes: new Set(draftFilters.sizes),
      priceMin: draftFilters.priceMin,
      priceMax: draftFilters.priceMax,
    });
    setIsFilterOpen(false);
  };
  const clearFilters = () => {
    const empty: ProductFilterState = { typeCategories: new Set<string>(), brands: new Set<string>(), genders: new Set<string>(), fits: new Set<string>(), feels: new Set<string>(), colorGroups: new Set<string>(), sizes: new Set<string>(), priceMin: null, priceMax: null };
    setDraftFilters(empty);
    setSelectedFilters(empty);
    setIsFilterOpen(false);
  };

  return (
    <>
      {/* Fullscreen Chat Overlay */}
      {showChat && (
        <div className="fixed inset-0 w-screen h-screen z-[85] bg-background flex flex-col" style={{ height: 'calc(100vh - 80px)', bottom: '80px' }}>
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Refine Your Search</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowChat(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1 bg-muted/20 rounded-lg p-3 mb-3 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              👋 Hi! I can help you find the perfect item. What are you looking for?
            </p>
          </div>
          <div className="flex gap-2 p-4 border-t border-border">
            <Textarea
              placeholder="Describe what you're looking for..."
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              className="flex-1 resize-none h-10"
              rows={1}
            />
            <Button size="sm" className="px-3">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Alternatives Panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 max-w-[45vw] sm:max-w-xs bg-background/98 backdrop-blur-xl border-l border-border/20 transform transition-all duration-500 ease-out z-[80] shadow-floating alternatives-panel",
          isVisible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
        )}
        onClick={(e) => {
          // Collapse expanded card when clicking anywhere outside the expanded card content
          if (isCurrentSelectionExpanded && expandedCardRef.current && !expandedCardRef.current.contains(e.target as Node)) {
            setIsCurrentSelectionExpanded(false);
          }
        }}
      >
        <div className="flex flex-col h-full backdrop-blur-sm">
          {/* Enhanced Header with Type Dropdown supporting Add/Remove */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-background/80 backdrop-blur-md">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 text-sm font-semibold px-2">
                  {(currentType || selectedItem.type) === 'top' ? 'Topwear' : (currentType || selectedItem.type) === 'bottom' ? 'Bottomwear' : (currentType || selectedItem.type) === 'shoes' ? 'Footwear' : 'Background'}
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="z-[90] min-w-[180px]">
                {(['top','bottom','shoes'] as const).map((t) => {
                  const isPresent = presentTypes.includes(t);
                  const label = t === 'top' ? 'Topwear' : t === 'bottom' ? 'Bottomwear' : 'Footwear';
                  return (
                    <div key={t} className="flex items-center justify-between px-2 py-1.5 cursor-pointer hover:bg-muted rounded-sm">
                      <div onClick={() => onTypeChange?.(t)} className="flex items-center gap-2">
                        {isPresent ? (
                          <span className="text-foreground text-sm">{label}</span>
                        ) : (
                          <span className="text-foreground text-sm inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add: {label}</span>
                        )}
                      </div>
                      {isPresent && (
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveType?.(t);
                          }}
                          aria-label={`Remove ${label}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="my-1 h-px bg-border/60" />
                <DropdownMenuItem onClick={() => onTypeChange?.('occasion')}>Background</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Enhanced Current Item */}
          <div className="p-2 border-b border-border/50 bg-muted/20 backdrop-blur-sm">
            {isOccasionType ? (
              <div 
                className="current-selection-card hover:shadow-md transition-all duration-300 cursor-pointer p-3"
                onClick={() => navigate(`/product/${displayItem.id}`)}
              >
                <div className="aspect-square mb-3 rounded-lg bg-muted overflow-hidden">
                  <img 
                    src={displayItem.imageUrl}
                    alt={displayItem.description}
                    className="w-full h-full object-contain transition-transform duration-300 hover:scale-105"
                  />
                </div>
                <h4 className="text-sm font-medium text-foreground truncate">{displayItem.description}</h4>
                <p className="text-xs text-muted-foreground">{displayItem.brand}</p>
              </div>
             ) : (
              <div className={cn(
                "current-selection-card transition-all duration-300 overflow-hidden",
                isCurrentSelectionExpanded ? "expanded" : ""
              )}>
                {!isCurrentSelectionExpanded ? (
                  // Minimal compact view - icon removed, chevron retained
                  <div className="p-2 cursor-pointer hover:bg-muted/30 transition-all duration-200" onClick={() => setIsCurrentSelectionExpanded(true)}>
                    <div className="flex items-center">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{displayItem.brand}</p>
                        {displayItem.type !== 'occasion' && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {displayItem.size ? `Size ${displayItem.size}` : ''}
                            {displayItem.size && (displayItem.price != null) ? ' • ' : ''}
                            {displayItem.price != null ? `${formatCurrency(displayItem.price)}` : ''}
                          </p>
                        )}
                      </div>
                      <ChevronDown className="w-4 h-4 text-muted-foreground ml-2 shrink-0" />
                    </div>
                  </div>
                ) : (
                  // Use unified EnhancedProductCard; start content at very top (no extra padding)
                  <div className="p-0" ref={expandedCardRef}>
                    <EnhancedProductCard
                      item={displayItem}
                      onCollapse={() => setIsCurrentSelectionExpanded(false)}
                      onSeeMore={() => navigate(`/product/${displayItem.id}`)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controls: Mode + Filter icon, then Sort + results */}
          {!isOccasionType && (
            <div className="px-2 pt-2 pb-1 border-b border-border/60">
              <div className="flex items-center justify-between gap-2">
                <Select value={filterMode} onValueChange={onFilterModeChange}>
                  <SelectTrigger className="h-7 text-xs w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[90]">
                    <SelectItem value="similar">Similar Items</SelectItem>
                    <SelectItem value="alternate">Alternate Items</SelectItem>
                    <SelectItem value="wardrobe">Wardrobe</SelectItem>
                    <SelectItem value="favorites">Favorites</SelectItem>
                    <SelectItem value="all">All Items</SelectItem>
                  </SelectContent>
                </Select>
                <Popover open={isFilterOpen} onOpenChange={(open) => open ? openFilters() : setIsFilterOpen(false)}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Filters">
                      <SlidersHorizontal className="w-4 h-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom" className="p-3 w-72 sm:w-80 z-[90]">
                    <ProductFiltersPanel
                      items={filterItems}
                      draft={draftFilters}
                      setDraft={setDraftFilters}
                      onClearAll={clearFilters}
                      onApply={applyFilters}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center justify-between mt-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-1 text-[11px]">
                      Sort: {selectedSort === 'price-low' ? 'Price: Low to High' : 'Price: High to Low'}
                      <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="z-[90]">
                    <DropdownMenuItem onClick={() => setSelectedSort('price-low')}>Price: Low to High</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedSort('price-high')}>Price: High to Low</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Results count removed as requested */}
              </div>
            </div>
          )}

          {/* Items Grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {!showChat ? (
              <>
                {isOccasionType && (
                  <p className="text-sm font-medium text-muted-foreground mb-3">
                    Occasion Backgrounds
                  </p>
                )}
                {/* Context line intentionally removed per request */}
                {isOccasionType ? (
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {occasionsLoading ? (
                      <div className="col-span-2 flex justify-center py-8">
                        <p className="text-muted-foreground">Loading occasions...</p>
                      </div>
                    ) : occasions.length > 0 ? (
                      occasions.map((occasion) => (
                        <div
                          key={occasion.id}
                          className={cn(
                            "bg-card border rounded-lg p-2 cursor-pointer transition-all duration-200",
                            "hover:shadow-md hover:scale-105",
                            selectedItem.imageUrl === occasion.backgroundUrl 
                              ? "border-primary bg-primary/5 ring-1 ring-primary/20" 
                              : "border-border/50 hover:border-primary/30"
                          )}
                          onClick={() => onOccasionSelect?.(occasion)}
                        >
                          <div className="aspect-square mb-2 rounded-lg bg-muted overflow-hidden">
                            <img 
                              src={occasion.backgroundUrl}
                              alt={occasion.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <h4 className="text-xs font-medium text-foreground truncate">{occasion.name}</h4>
                          <p className="text-xs text-muted-foreground truncate">{occasion.description}</p>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 text-center py-8">
                        <p className="text-muted-foreground">No occasions available</p>
                      </div>
                    )}
                  </div>
                ) : panelProducts.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {panelProducts
                      .filter(item => item.id !== selectedItem.id)
                      .map((item, index) => (
                        <div
                          key={item.id}
                          className="alternatives-card group cursor-pointer p-1"
                          onClick={() => onItemSelect(item)}
                          style={{ animationDelay: `${index * 50}ms` }}
                        >
                          {/* Polaroid-style image with thin bezel */}
                          <div className="aspect-square bg-white rounded-xl overflow-hidden mb-1 flex items-center justify-center ring-[0.5px] ring-border/60 p-[1px]">
                            <img 
                              src={item.imageUrl}
                              alt={item.description}
                              className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-110"
                            />
                          </div>
                          <div className="space-y-1">
                            {/* Product name: show product id in sentence case (two lines if needed) */}
                            <h4 className="text-[9px] font-medium text-foreground line-clamp-2 leading-snug normal-case">
                              {toSentenceCase(item.id)}
                            </h4>
                            {/* Bottom row: Brand and Price (Fit removed) */}
                            <div className="grid grid-cols-[1fr_auto] items-center gap-1">
                              <p className="text-[9px] text-muted-foreground truncate pr-1">{item.brand}</p>
                              <span className="text-[9px] text-muted-foreground font-medium justify-self-end pl-1">
                                {item.price >= 5000 ? '₹₹₹₹' : 
                                 item.price >= 3000 ? '₹₹₹' : 
                                 item.price >= 1500 ? '₹₹' : '₹'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-40">
                    <p className="text-muted-foreground text-center">
                      {isSearching && alternateSearchQuery.trim()
                        ? `Looking for ${alternateSearchQuery.trim()}…`
                        : hasSearched && alternateSearchQuery.trim()
                          ? 'No search results found'
                          : 'No alternatives available'}
                    </p>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Enhanced Footer */}
          <div className="p-2 border-t border-border/50 pb-16 bg-background/80 backdrop-blur-md">
            <div className="relative">
              <Input
                placeholder={isOccasionType 
                  ? 'Search backgrounds…' 
                  : `Search ${(currentType || selectedItem.type) === 'top' ? 'tops' : (currentType || selectedItem.type) === 'bottom' ? 'bottoms' : 'shoes'}...`}
                value={alternateSearchQuery}
                onChange={handleSearchInputChange}
                onKeyDown={handleSearchKeyDown}
                className="h-8 text-xs pr-8"
                disabled={isSearching || vectorSearchLoading || isOccasionType}
              />
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                {isOccasionType ? null : isSearching || vectorSearchLoading ? (
                  <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
                ) : (
                  <button
                    onClick={handleSearchSubmit}
                    disabled={!alternateSearchQuery.trim() || alternateSearchQuery.trim().length < 3}
                    className="p-1 hover:bg-muted/50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Search"
                    aria-label="Search"
                  >
                    <Search className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}