import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Heart, Bookmark, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Outfit } from '@/types';
import { supabase } from '@/integrations/supabase/client'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { DynamicAvatar } from '@/components/studio/DynamicAvatar';
import { useProfile } from '@/hooks/useProfile';
import { getCategoryColors, formatCategoryName, NEUTRAL_CHIP_STYLES } from '@/utils/categoryColors';
import { SimilarityBadge } from '@/components/ui/similarity-badge';
import { FEATURE_FLAGS } from '@/utils/constants';

interface OutfitCardProps {
  outfit: Outfit & { similarityScore?: number };
  onSelect?: () => void;
  onClick?: () => void;
  className?: string;
  showRemoveButton?: boolean;
  onRemove?: () => void;
  onFavoriteToggle?: () => void;
  isFavorite?: boolean;
  maxCardWidth: number;
}

export function OutfitCard({ 
  outfit, 
  onSelect, 
  onClick, 
  className, 
  showRemoveButton, 
  onRemove, 
  onFavoriteToggle, 
  isFavorite, 
  maxCardWidth 
}: OutfitCardProps) {
  const { profile, getUserAvatarUrl } = useProfile();
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = React.useState<number>(maxCardWidth);

  React.useEffect(() => {
    const node = cardRef.current;
    if (!node) return;

    const updateWidth = (width: number) => {
      if (width > 0) {
        setCardWidth(width);
      }
    };

    // Initialize with current width (fallback to maxCardWidth if still hidden)
    updateWidth(node.offsetWidth || maxCardWidth);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect?.width;
        if (typeof width === 'number') {
          updateWidth(width);
        }
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [maxCardWidth]);

  // Get user's avatar URL using the new helper function
  const userAvatarUrl = getUserAvatarUrl();

  const handleClick = () => {
    if (onSelect) onSelect();
    if (onClick) onClick();
  };

  // Responsive avatar height: 4/3 of card width (for 3:4 aspect ratio)
  const avatarHeight = cardWidth * (4 / 3);

  // Collections picker state
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [collections, setCollections] = React.useState<{ slug: string; label: string }[]>([])
  const [selectedSlugs, setSelectedSlugs] = React.useState<Set<string>>(new Set())
  const [initialSelectedSlugs, setInitialSelectedSlugs] = React.useState<Set<string>>(new Set())
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')

  async function loadCollections() {
    try {
      const { data, error } = await (supabase as any).rpc('get_user_collections')
      if (error) throw error as any
      const rows = (data as any[] | null) || []
      const nonSystem = rows.filter((r:any) => !r.is_system).map((r:any) => ({ slug: r.collection_slug, label: r.collection_label }))
      setCollections(nonSystem)
      // Preselect existing memberships
      const { data: mine } = await supabase.from('user_favorites').select('collection_slug').eq('outfit_id', outfit.id)
      const set = new Set<string>((mine || []).map((m:any)=>m.collection_slug))
      setSelectedSlugs(set)
      setInitialSelectedSlugs(new Set(set))
    } catch {
      setCollections([])
    }
  }

  function slugify(name: string) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  }

  async function addSelectedToCollections() {
    try {
      const { data: u } = await supabase.auth.getUser()
      const userId = u?.user?.id || null
      if (!userId) throw new Error('No user session')
      for (const slug of Array.from(selectedSlugs)) {
        if (!initialSelectedSlugs.has(slug)) {
          const label = collections.find(c=>c.slug===slug)?.label || slug
          await supabase.from('user_favorites').insert({ user_id: userId, outfit_id: outfit.id, collection_slug: slug, collection_label: label })
        }
      }
      setInitialSelectedSlugs(new Set(selectedSlugs))
      setMenuOpen(false)
    } catch {
      setMenuOpen(false)
    }
  }

  // Mock data for wardrobe count and creator (will be replaced with real data)
  const wardrobeCount = Math.floor(Math.random() * 5) + 1; // 1-5 items
  const creatorName = 'Style Co'; // Will be replaced with real creator data

  // Generate outfit details string
  const getOutfitDetails = () => {
    const details = [];
    if (outfit.category) details.push(outfit.category);
    if (outfit.fit) details.push(outfit.fit);
    if (outfit.feel) details.push(outfit.feel);
    return details.join(' • ');
  };

  // Helper function to parse feel values and limit to 2
  const getFeelChips = () => {
    if (!outfit.feel) return [];
    const feels = outfit.feel.split(',').map(f => f.trim()).filter(Boolean);
    return feels.slice(0, 2); // Only show first 2 feels
  };

  // Get category colors for chip styling
  const categoryColors = getCategoryColors(outfit.category);
  const feelChips = getFeelChips();
  const hasMoreFeels = outfit.feel && outfit.feel.split(',').length > 2;


  return (
    <Card 
      className={cn(
        "overflow-hidden cursor-pointer flex flex-col group",
        "card-premium no-shadow hover-lift hover-glow",
        "transition-premium hover:scale-[1.02] active:scale-[0.98]",
        "animate-fade-in",
        className
      )}
      onClick={handleClick}
      ref={cardRef}
    >
      <CardContent className="p-0 flex flex-col flex-1">
        <div className="relative">
          {/* Similarity Badge - Only show if similarity score exists */}
          {FEATURE_FLAGS.SHOW_SIMILARITY_BADGE && outfit.similarityScore !== undefined && (
            <SimilarityBadge score={outfit.similarityScore} />
          )}
          
          {/* Background Image */}
          <div className="w-full aspect-[3/4] relative overflow-hidden">
            <img 
              src={outfit.backgroundId || outfit.occasion?.backgroundUrl || '/Backgrounds/7.png'}
              alt="Outfit Background"
              className="w-full h-full object-cover opacity-70"
            />
            
            {/* Avatar overlay */}
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ paddingTop: '6%' }}
            >
              <DynamicAvatar 
                items={outfit.items}
                containerHeight={avatarHeight}
              />
            </div>




            {/* Heart Button - Top Right */}
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 w-8 h-8 p-0 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                if (onFavoriteToggle) onFavoriteToggle();
              }}
              onContextMenu={(event) => event.preventDefault()}
              style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
            >
              <Heart className={cn(
                "w-5 h-5 transition-colors", 
                isFavorite ? "fill-red-500 text-red-500" : "text-red-500 stroke-2 hover:fill-red-500"
              )} strokeWidth={2}/>
            </Button>

            {/* Bookmark Button - Under Heart */}
            <Popover open={menuOpen} onOpenChange={(open)=>{ setMenuOpen(open); if (open) { setCreating(false); setNewName(''); loadCollections(); } }}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-12 right-2 w-8 h-8 p-0 transition-colors"
                  onClick={(e)=>{ e.stopPropagation() }}
                >
                  <Bookmark className={cn("w-5 h-5 text-foreground")}/>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2" onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
                <div className="px-1 pb-2 flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">Add to lookbook</div>
                  <button aria-label="Close" className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted" onClick={()=>setMenuOpen(false)}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {collections.map((c) => {
                    const checked = selectedSlugs.has(c.slug)
                    return (
                      <div key={c.slug} className="flex items-center justify-between px-2 py-2 rounded hover:bg-muted cursor-pointer"
                        onClick={(e)=>{ e.stopPropagation(); const next = new Set(selectedSlugs); if (checked) next.delete(c.slug); else next.add(c.slug); setSelectedSlugs(next) }}>
                        <span className="text-sm">{c.label}</span>
                        <Checkbox checked={checked} onCheckedChange={(val:any)=>{ const next = new Set(selectedSlugs); if (val) next.add(c.slug); else next.delete(c.slug); setSelectedSlugs(next) }} />
                      </div>
                    )
                  })}
                  {!creating && (
                    <div className="px-2 py-2 text-sm text-primary cursor-pointer hover:bg-muted rounded" onClick={(e)=>{ e.stopPropagation(); setCreating(true) }}>+ Create lookbook</div>
                  )}
                  {creating && (
                    <div className="px-2 py-2 space-y-2">
                      <Input placeholder="Collection name" value={newName} onChange={(e)=>setNewName(e.target.value)} />
                      <div className="flex gap-2">
                        <Button variant="secondary" className="flex-1" onClick={()=>{ setCreating(false); setNewName('') }}>Cancel</Button>
                        <Button className="flex-1" onClick={async ()=>{
                          const label = newName.trim(); if (!label) return; const slug = slugify(label); try {
                            const { error } = await (supabase as any).rpc('manage_collection', { p_operation: 'create', p_collection_slug: slug, p_collection_label: label }); if (error) throw error;
                            await loadCollections();
                            const next = new Set(selectedSlugs); next.add(slug); setSelectedSlugs(next);
                            setCreating(false); setNewName('');
                          } catch {}
                        }}>Create</Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="pt-2 border-t mt-2 flex justify-end">
                  <Button size="sm" className="rounded-full px-4" onClick={addSelectedToCollections}>Add item</Button>
                </div>
              </PopoverContent>
            </Popover>

          </div>
        </div>
        
        {/* Content Area - Compact */}
        <div className="p-2 pb-1 flex-1">
          <div className="flex flex-col space-y-0.5">
             {/* Outfit Name */}
             <h3 className="text-xs font-bold text-foreground text-left truncate group-hover:text-primary transition-premium">
              {outfit.name || "Weekend Vibes"}
            </h3>
            {/* Creator byline */}
            {outfit.created_by && (
              <p className="text-[8px] font-normal text-muted-foreground text-left truncate">
                curated by {outfit.created_by}
              </p>
            )}

            {/* Chips Row: single-line horizontal scroll */}
            <div className="flex gap-1 items-center overflow-x-auto scrollbar-hide whitespace-nowrap pr-1">
              {/* Category Chip */}
              <span className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-medium border flex-shrink-0',
                categoryColors.bg,
                categoryColors.text,
                categoryColors.border
              )}>
                {formatCategoryName(outfit.category)}
              </span>

              {/* Fit Chip */}
              {outfit.fit && (
                <span className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-medium border flex-shrink-0',
                  NEUTRAL_CHIP_STYLES.bg,
                  NEUTRAL_CHIP_STYLES.text,
                  NEUTRAL_CHIP_STYLES.border
                )}>
                  {outfit.fit}
                </span>
              )}

              {/* Feel Chips (max 2) */}
              {feelChips.map((feel, index) => (
                <span key={index} className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-medium border flex-shrink-0',
                  NEUTRAL_CHIP_STYLES.bg,
                  NEUTRAL_CHIP_STYLES.text,
                  NEUTRAL_CHIP_STYLES.border
                )}>
                  {feel}
                </span>
              ))}

              {/* +N indicator for additional feels */}
              {hasMoreFeels && (
                <span className={cn(
                  'inline-flex items-center px-1 py-0.5 rounded-full text-[8px] font-medium border flex-shrink-0',
                  NEUTRAL_CHIP_STYLES.bg,
                  'text-gray-500',
                  NEUTRAL_CHIP_STYLES.border
                )}>
                  +{outfit.feel!.split(',').length - 2}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      {/* Bookmark dropdown implemented above */}
    </Card>
  );
}
