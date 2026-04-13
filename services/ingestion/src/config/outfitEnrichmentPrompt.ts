export const OUTFIT_ENRICH_PROMPT_VERSION = 'v1';

export const OUTFIT_SYSTEM_INSTRUCTION = `You are an expert Fashion Director and AI Merchandiser. Your objective is to analyze an outfit image to generate structured metadata, specific UI tags, and a highly exhaustive search-optimized summary.

**1. APP UI CLASSIFICATION (Strict Selection)**
Select ONE value strictly from the provided dictionaries for 'ui_category' and 'ui_occasion'.
- **Category Options:** ['Casual Outing', 'CEO Core', 'Date Ready', 'Old Money', 'Streetwear', 'Others']
- **Occasion Options:** ['Brunch', 'Business Casual', 'Casual Outing', 'Date', 'Party', 'Travel', 'Important Event', 'Office Wear', 'Default', 'Others']

**2. COMPONENT INVENTORY (Zero-Miss Protocol)**
You must identify EVERY visible item. Do not group them broadly. Break them down:
- **Main Apparel:** Tops (Inner/Outer layers), Bottoms, Dresses, Outerwear.
- **Footwear:** Specific shoe type (e.g., 'Chelsea Boot' not just 'Boots').
- **Accessories:** Bags, Belts, Hats, Scarves, Sunglasses, Jewelry (Necklaces, Rings, Watches).
- *Note: If an item is partially visible, infer it based on context but label it clearly.*

**3. OUTFIT ANALYSIS**
- **Analyzed Occasions:** Array of 3 distinct strings (Primary + 2 Alternatives).
- **Visual Attributes:** Fit (2-3 tags), Feel (2-3 tags), Vibes (1-3 tags), Word Association (3-5 tags).
- **Marketing Name:** Catchy 3-5 word lookbook title.

**4. SEARCH SUMMARY (The 'Deep Semantic Stack')**
Construct a dense, exhaustive paragraph covering these 6 layers:
   A. **Full Inventory:** Explicitly name every identified component (e.g., '...styled with a gold chain necklace and leather belt...').
   B. **Color & Theme:** Palette and temperature.
   C. **Silhouette:** Architecture of the look.
   D. **Aesthetic Mapping:** Sub-cultures and vibes.
   E. **Suitability:** Weather, environment, user persona.
   F. **3 Styling Notes:** Specific styling techniques used.

**5. JSON OUTPUT FORMAT**
Return strictly valid JSON. Keys: 'outfit_name', 'ui_category', 'ui_occasion', 'analyzed_occasions', 'components_list' (array of strings), 'fit', 'feel', 'word_association', 'vibes', 'description_text', 'search_summary'.`;

export const OUTFIT_PROMPT_TEMPLATE = `Analyze the attached outfit image and the context below to generate the enrichment JSON.

**Provided Context (Prioritize if present):**
<context>
User Gender: {gender_input}
User Preferred Category: {category_input}
User Preferred Occasion: {occasion_input}
Input Description: {description}
</context>

**Task:**
1. **Inventory Scan:** Visually scan head-to-toe and populate the 'components_list' with EVERY distinct item (including jewelry, belts, bags).
2. **Classify:** Select strict UI tags.
3. **Analyze:** Generate marketing name, occasions, and visual attributes.
4. **Search Summary (Exhaustive):** Write a detailed paragraph. Ensure the Full Inventory is woven into the text naturally.
5. **Description:** Write a separate 4-sentence editorial description.
5. Output only the JSON object.`;

export const OUTFIT_DEFAULTS: Required<OutfitEnrichmentHints> = {
  genderInput: 'N/A',
  categoryInput: 'N/A',
  occasionInput: 'N/A',
  description: 'N/A',
};

export type OutfitEnrichmentHints = {
  genderInput?: string;
  categoryInput?: string;
  occasionInput?: string;
  description?: string;
};

export type OutfitEnrichmentOutput = {
  outfit_name: string | null;
  ui_category: string | null;
  ui_occasion: string | null;
  analyzed_occasions: string[] | null;
  components_list: string[] | null;
  fit: string[] | null;
  feel: string[] | null;
  word_association: string[] | null;
  vibes: string[] | null;
  description_text: string | null;
  search_summary: string | null;
};

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeStringArray(value: unknown, maxItems: number): string[] | null {
  const items: string[] = [];

  if (Array.isArray(value)) {
    for (const entry of value) {
      const token = asString(entry);
      if (token) items.push(token);
    }
  } else if (typeof value === 'string') {
    const raw = value.trim();
    if (raw.length) {
      raw
        .split(/[,|\n]/g)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((token) => items.push(token));
    }
  }

  const deduped = Array.from(new Set(items));
  if (!deduped.length) return null;
  return deduped.slice(0, Math.max(1, maxItems));
}

export function buildOutfitEnrichmentPrompt(hints: OutfitEnrichmentHints): string {
  const ctx = {
    gender_input: asString(hints.genderInput) ?? OUTFIT_DEFAULTS.genderInput,
    category_input: asString(hints.categoryInput) ?? OUTFIT_DEFAULTS.categoryInput,
    occasion_input: asString(hints.occasionInput) ?? OUTFIT_DEFAULTS.occasionInput,
    description: asString(hints.description) ?? OUTFIT_DEFAULTS.description,
  };

  return OUTFIT_PROMPT_TEMPLATE
    .replace('{gender_input}', ctx.gender_input)
    .replace('{category_input}', ctx.category_input)
    .replace('{occasion_input}', ctx.occasion_input)
    .replace('{description}', ctx.description);
}

export function normalizeOutfitEnrichmentOutput(raw: unknown): OutfitEnrichmentOutput {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const outfitName = asString(obj.outfit_name) ?? asString(obj.outfitName) ?? null;
  const uiCategory = asString(obj.ui_category) ?? asString(obj.uiCategory) ?? null;
  const uiOccasion = asString(obj.ui_occasion) ?? asString(obj.uiOccasion) ?? null;

  const fit = normalizeStringArray(obj.fit, 3);
  const feel = normalizeStringArray(obj.feel, 3);
  const vibes = normalizeStringArray(obj.vibes, 3);
  const wordAssociation = normalizeStringArray(obj.word_association ?? obj.wordAssociation, 5);
  const analyzedOccasionsCandidates = normalizeStringArray(obj.analyzed_occasions ?? obj.analyzedOccasions, 6);
  const analyzedOccasionsDistinct = analyzedOccasionsCandidates ? Array.from(new Set(analyzedOccasionsCandidates)) : null;
  const analyzedOccasions = analyzedOccasionsDistinct && analyzedOccasionsDistinct.length === 3 ? analyzedOccasionsDistinct : null;
  const componentsListCandidates = normalizeStringArray(obj.components_list ?? obj.componentsList, 50);
  const componentsListDistinct = componentsListCandidates ? Array.from(new Set(componentsListCandidates)) : null;
  const componentsList = componentsListDistinct && componentsListDistinct.length > 0 ? componentsListDistinct : null;
  const descriptionText =
    asString(obj.description_text) ??
    asString(obj.descriptionText) ??
    asString(obj.description) ??
    null;
  const searchSummary =
    asString(obj.search_summary) ??
    asString(obj.searchSummary) ??
    null;

  return {
    outfit_name: outfitName,
    ui_category: uiCategory,
    ui_occasion: uiOccasion,
    analyzed_occasions: analyzedOccasions,
    components_list: componentsList,
    fit,
    feel,
    vibes,
    word_association: wordAssociation,
    description_text: descriptionText,
    search_summary: searchSummary,
  };
}

