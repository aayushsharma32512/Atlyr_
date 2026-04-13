import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';

type Gender = 'male' | 'female' | 'unisex';

export interface ProductFilterState {
  typeCategories: Set<string>;
  brands: Set<string>;
  genders: Set<string>;
  fits: Set<string>;
  feels: Set<string>;
  colorGroups: Set<string>;
  sizes: Set<string>;
  priceMin: number | null;
  priceMax: number | null;
}

export interface FilterableItem {
  brand?: string;
  product_name?: string | null;
  price?: number;
  currency?: string;
  description?: string;
  color?: string;
  color_group?: string | null;
  gender?: Gender | null;
  size?: string;
  fit?: string | null;
  feel?: string | null;
  type_category?: string | null;
  // For alternates coming from OutfitItem
  type?: 'top' | 'bottom' | 'shoes' | 'accessory' | 'occasion';
}

function toTitleCaseSlug(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveTypeCategory(item: FilterableItem): string | null {
  if (item.type_category) return item.type_category;
  if (item.type) {
    switch (item.type) {
      case 'top': return 'tops';
      case 'bottom': return 'bottoms';
      case 'shoes': return 'shoes';
      case 'accessory': return 'accessories';
      default: return null;
    }
  }
  return null;
}

interface ProductFiltersPanelProps {
  items: FilterableItem[];
  draft: ProductFilterState;
  setDraft: (next: ProductFilterState) => void;
  onClearAll: () => void;
  onApply: () => void;
  className?: string;
}

export function ProductFiltersPanel({ items, draft, setDraft, onClearAll, onApply, className }: ProductFiltersPanelProps) {
  // Unique option lists
  const uniqueTypeCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const it of items) {
      const cat = deriveTypeCategory(it);
      if (cat) cats.add(cat);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const uniqueBrands = useMemo(() => Array.from(new Set(items.map(i => i.brand).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [items]);
  const uniqueGenders = useMemo(() => Array.from(new Set(items.map(i => i.gender).filter(Boolean) as string[])) as string[], [items]);
  const uniqueFits = useMemo(() => Array.from(new Set(items.map(i => i.fit).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [items]);
  const uniqueFeels = useMemo(() => Array.from(new Set(items.map(i => i.feel).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [items]);
  const uniqueColorGroups = useMemo(() => Array.from(new Set(items.map(i => i.color_group).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [items]);
  const uniqueSizes = useMemo(() => Array.from(new Set(items.map(i => i.size).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [items]);

  // Static counts per option (computed from full base set)
  const getCount = (section: keyof ProductFilterState, option: string) => {
    let count = 0;
    for (const it of items) {
      if (section === 'typeCategories' && deriveTypeCategory(it) === option) count++;
      if (section === 'brands' && it.brand === option) count++;
      if (section === 'genders' && it.gender === option) count++;
      if (section === 'fits' && it.fit === option) count++;
      if (section === 'feels' && it.feel === option) count++;
      if (section === 'colorGroups' && it.color_group === option) count++;
      if (section === 'sizes' && it.size === option) count++;
    }
    return count;
  };

  // Toggle helpers
  const toggle = (section: keyof ProductFilterState, value: string) => {
    const next: ProductFilterState = {
      typeCategories: new Set(draft.typeCategories),
      brands: new Set(draft.brands),
      genders: new Set(draft.genders),
      fits: new Set(draft.fits),
      feels: new Set(draft.feels),
      colorGroups: new Set(draft.colorGroups),
      sizes: new Set(draft.sizes),
      priceMin: draft.priceMin,
      priceMax: draft.priceMax,
    };
    const set = next[section] as unknown as Set<string>;
    if (set.has(value)) set.delete(value); else set.add(value);
    setDraft(next);
  };

  const removeValue = (section: keyof ProductFilterState, value: string) => {
    const next: ProductFilterState = {
      typeCategories: new Set(draft.typeCategories),
      brands: new Set(draft.brands),
      genders: new Set(draft.genders),
      fits: new Set(draft.fits),
      feels: new Set(draft.feels),
      colorGroups: new Set(draft.colorGroups),
      sizes: new Set(draft.sizes),
      priceMin: draft.priceMin,
      priceMax: draft.priceMax,
    };
    (next[section] as unknown as Set<string>).delete(value);
    setDraft(next);
  };

  // Dynamic summary count based on draft
  const draftCount = useMemo(() => {
    let count = 0;
    for (const it of items) {
      if (draft.typeCategories.size > 0) {
        const cat = deriveTypeCategory(it);
        if (!(cat && draft.typeCategories.has(cat))) continue;
      }
      if (draft.brands.size > 0 && !(it.brand && draft.brands.has(it.brand))) continue;
      if (draft.genders.size > 0 && !(it.gender && draft.genders.has(it.gender))) continue;
      if (draft.fits.size > 0 && !(it.fit && draft.fits.has(it.fit))) continue;
      if (draft.feels.size > 0 && !(it.feel && draft.feels.has(it.feel))) continue;
      if (draft.colorGroups.size > 0 && !(it.color_group && draft.colorGroups.has(it.color_group))) continue;
      if (draft.sizes.size > 0 && !(it.size && draft.sizes.has(it.size))) continue;
      if (draft.priceMin != null && (it.price ?? 0) < draft.priceMin) continue;
      if (draft.priceMax != null && (it.price ?? 0) > draft.priceMax) continue;
      count++;
    }
    return count;
  }, [items, draft]);

  return (
    <div className={className}>
      {/* Selected pills */}
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.5rem]">
        {Array.from(draft.typeCategories).map((val) => (
          <span key={`ptype-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-slate-100 text-slate-800 border-slate-200">
            {toTitleCaseSlug(val)}
            <button onClick={() => removeValue('typeCategories', val)} className="opacity-70 hover:opacity-100">×</button>
          </span>
        ))}
        {Array.from(draft.brands).map((val) => (
          <span key={`brand-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-slate-50 text-slate-800 border-slate-200">
            {val}
            <button onClick={() => removeValue('brands', val)} className="opacity-70 hover:opacity-100">×</button>
          </span>
        ))}
        {Array.from(draft.genders).map((val) => (
          <span key={`pgender-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-blue-50 text-slate-800 border-blue-100">
            {toTitleCaseSlug(val)}
            <button onClick={() => removeValue('genders', val)} className="opacity-70 hover:opacity-100">×</button>
          </span>
        ))}
        {Array.from(draft.fits).map((val) => (
          <span key={`pfit-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-emerald-50 text-slate-800 border-emerald-100">
            {toTitleCaseSlug(val)}
            <button onClick={() => removeValue('fits', val)} className="opacity-70 hover:opacity-100">×</button>
          </span>
        ))}
        {Array.from(draft.feels).map((val) => (
          <span key={`pfeel-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-amber-50 text-slate-800 border-amber-100">
            {toTitleCaseSlug(val)}
            <button onClick={() => removeValue('feels', val)} className="opacity-70 hover:opacity-100">×</button>
          </span>
        ))}
        {Array.from(draft.colorGroups).map((val) => (
          <span key={`pcolor-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-purple-50 text-slate-800 border-purple-100">
            {toTitleCaseSlug(val)}
            <button onClick={() => removeValue('colorGroups', val)} className="opacity-70 hover:opacity-100">×</button>
          </span>
        ))}
        {Array.from(draft.sizes).map((val) => (
          <span key={`psize-${val}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-zinc-50 text-slate-800 border-zinc-200">
            {val}
            <button onClick={() => removeValue('sizes', val)} className="opacity-70 hover:opacity-100">×</button>
          </span>
        ))}
        {draft.typeCategories.size === 0 && draft.brands.size === 0 && draft.genders.size === 0 && draft.fits.size === 0 && draft.feels.size === 0 && draft.colorGroups.size === 0 && draft.sizes.size === 0 && draft.priceMin == null && draft.priceMax == null && (
          <span className="text-xs text-muted-foreground">No filters selected</span>
        )}
        {(draft.priceMin != null || draft.priceMax != null) && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border bg-zinc-50 text-slate-800 border-zinc-200">
            ₹{draft.priceMin ?? 0} - ₹{draft.priceMax ?? 20000}
          </span>
        )}
      </div>

      <Accordion type="multiple" className="mt-1">
        <AccordionItem value="price">
          <AccordionTrigger>Price</AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Min</span>
                <Input
                  type="number"
                  value={draft.priceMin ?? ''}
                  placeholder="0"
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                    setDraft({
                      ...draft,
                      typeCategories: new Set(draft.typeCategories),
                      brands: new Set(draft.brands),
                      genders: new Set(draft.genders),
                      fits: new Set(draft.fits),
                      feels: new Set(draft.feels),
                      colorGroups: new Set(draft.colorGroups),
                      sizes: new Set(draft.sizes),
                      priceMin: val,
                    });
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Max</span>
                <Input
                  type="number"
                  value={draft.priceMax ?? ''}
                  placeholder="20000"
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                    setDraft({
                      ...draft,
                      typeCategories: new Set(draft.typeCategories),
                      brands: new Set(draft.brands),
                      genders: new Set(draft.genders),
                      fits: new Set(draft.fits),
                      feels: new Set(draft.feels),
                      colorGroups: new Set(draft.colorGroups),
                      sizes: new Set(draft.sizes),
                      priceMax: val,
                    });
                  }}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {uniqueTypeCategories.length > 0 && (
          <AccordionItem value="type_category">
            <AccordionTrigger>Type Category</AccordionTrigger>
            <AccordionContent>
              <div className="max-h-56 overflow-y-auto pr-1">
                {uniqueTypeCategories.map((opt) => {
                  const checked = draft.typeCategories.has(opt);
                  const count = getCount('typeCategories', opt);
                  const disabled = count === 0;
                  return (
                    <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => !disabled && toggle('typeCategories', opt)}
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
        )}

        <AccordionItem value="brand">
          <AccordionTrigger>Brand</AccordionTrigger>
          <AccordionContent>
            <div className="max-h-56 overflow-y-auto pr-1">
              {uniqueBrands.map((opt) => {
                const checked = draft.brands.has(opt);
                const count = getCount('brands', opt);
                const disabled = count === 0;
                return (
                  <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => !disabled && toggle('brands', opt)}
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

        <AccordionItem value="gender">
          <AccordionTrigger>Gender</AccordionTrigger>
          <AccordionContent>
            <div className="max-h-56 overflow-y-auto pr-1">
              {(uniqueGenders.length ? uniqueGenders : ['male','female','unisex']).map((opt) => {
                const checked = draft.genders.has(opt);
                const count = getCount('genders', opt);
                const disabled = count === 0;
                return (
                  <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => !disabled && toggle('genders', opt)}
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

        <AccordionItem value="fit">
          <AccordionTrigger>Fit</AccordionTrigger>
          <AccordionContent>
            <div className="max-h-56 overflow-y-auto pr-1">
              {uniqueFits.map((opt) => {
                const checked = draft.fits.has(opt);
                const count = getCount('fits', opt);
                const disabled = count === 0;
                return (
                  <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => !disabled && toggle('fits', opt)}
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

        <AccordionItem value="feel">
          <AccordionTrigger>Feel</AccordionTrigger>
          <AccordionContent>
            <div className="max-h-56 overflow-y-auto pr-1">
              {uniqueFeels.map((opt) => {
                const checked = draft.feels.has(opt);
                const count = getCount('feels', opt);
                const disabled = count === 0;
                return (
                  <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => !disabled && toggle('feels', opt)}
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

        <AccordionItem value="color_group">
          <AccordionTrigger>Color Group</AccordionTrigger>
          <AccordionContent>
            <div className="max-h-56 overflow-y-auto pr-1">
              {uniqueColorGroups.map((opt) => {
                const checked = draft.colorGroups.has(opt);
                const count = getCount('colorGroups', opt);
                const disabled = count === 0;
                return (
                  <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => !disabled && toggle('colorGroups', opt)}
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

        <AccordionItem value="size">
          <AccordionTrigger>Size</AccordionTrigger>
          <AccordionContent>
            <div className="max-h-56 overflow-y-auto pr-1">
              {uniqueSizes.map((opt) => {
                const checked = draft.sizes.has(opt);
                const count = getCount('sizes', opt);
                const disabled = count === 0;
                return (
                  <label key={opt} className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => !disabled && toggle('sizes', opt)}
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

      <div className="mt-3 space-y-2">
        <div className="text-xs text-muted-foreground text-center">{`Showing ${draftCount} Products`}</div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onClearAll}>Clear all</Button>
          <Button onClick={onApply}>Apply</Button>
        </div>
      </div>
    </div>
  );
}

export default ProductFiltersPanel;


