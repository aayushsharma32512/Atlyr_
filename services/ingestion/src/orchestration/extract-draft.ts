import { ExtractDraftOutput, type ExtractDraftOutputT } from '../domain/contracts';

type UnknownRecord = Record<string, unknown>;

export interface BuildExtractDraftArgs {
  dedupeKey: string;
  originalUrl: string;
  jsonDoc: UnknownRecord;
  metaDoc: UnknownRecord;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickFirstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickFirstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
      if (!cleaned) continue;
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function normalizeCurrency(code?: string): string | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toUpperCase();
  if (['RS', 'RUPEES', '₹'].includes(normalized)) return 'INR';
  return normalized.length === 3 ? normalized : undefined;
}

function normalizeImageKind(kind: unknown): 'flatlay' | 'model' | 'detail' | null {
  if (typeof kind !== 'string') return null;
  const lower = kind.trim().toLowerCase();
  if (['flatlay', 'laydown', 'lay-flat'].includes(lower)) return 'flatlay';
  if (['model', 'on-model', 'lifestyle'].includes(lower)) return 'model';
  if (['detail', 'closeup', 'close-up'].includes(lower)) return 'detail';
  return null;
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
    )
  );
}

function asObject(value: unknown): UnknownRecord | undefined {
  if (!value) return undefined;
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => Boolean(entry));
  if (!entries.length) return undefined;
  return Array.from(new Set(entries));
}

function inferTypeFromBreadcrumbs(jsonDoc: UnknownRecord): 'top' | 'bottom' | 'shoes' | 'accessory' | 'occasion' | undefined {
  const breadcrumbs = Array.isArray(jsonDoc.breadcrumbs) ? jsonDoc.breadcrumbs : [];
  const src = `${breadcrumbs.join(' ')}`.toLowerCase();
  if (/shirt|tee|t[- ]?shirt|top/.test(src)) return 'top';
  if (/jean|pant|trouser|bottom/.test(src)) return 'bottom';
  if (/shoe|sneaker|boot|loafer|sandal/.test(src)) return 'shoes';
  if (/bag|belt|hat|cap|scarf|accessor/.test(src)) return 'accessory';
  if (/dress|skirt|gown/.test(src)) return 'occasion';
  return undefined;
}

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const BODY_SEGMENTS = new Set(['head', 'neck', 'torso', 'arm_left', 'arm_right', 'legs', 'feet']);
const BODY_SEGMENT_ALIASES: Record<string, string[]> = {
  arms: ['arm_left', 'arm_right'],
  arm: ['arm_left', 'arm_right']
};

function normalizeBodyPartsVisible(value: unknown): string[] | null {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[|,]/)
      : [];

  const normalized = source
    .map((entry) => {
      if (typeof entry !== 'string') return '';
      return entry.trim().toLowerCase().replace(/[\s-]+/g, '_');
    })
    .filter(Boolean)
    .flatMap((entry) => BODY_SEGMENT_ALIASES[entry] ?? [entry])
    .filter((entry) => BODY_SEGMENTS.has(entry));

  const deduped = Array.from(new Set(normalized));
  return deduped.length ? deduped : null;
}

export function buildExtractDraft(args: BuildExtractDraftArgs): ExtractDraftOutputT {
  const { dedupeKey, originalUrl, jsonDoc, metaDoc } = args;

  const product = isRecord(jsonDoc.product) ? (jsonDoc.product as UnknownRecord) : {};

  const productName = pickFirstString([
    product.name,
    jsonDoc.product_name,
    jsonDoc.title,
    metaDoc.title
  ]);

  const brand = pickFirstString([
    typeof product.brand === 'string' ? product.brand : isRecord(product.brand) ? product.brand.name : undefined,
    jsonDoc.brand,
    metaDoc.brand,
    isRecord(metaDoc.og) ? (metaDoc.og.site_name as unknown) : undefined
  ]);

  const currency = normalizeCurrency(
    pickFirstString([
      isRecord(product.offers) ? (product.offers.priceCurrency as unknown) : undefined,
      jsonDoc.currency
    ])
  ) || 'INR';

  const priceMinor = pickFirstNumber([
    product.price_minor,
    jsonDoc.price_minor,
    product.priceMinor,
    jsonDoc.priceMinor
  ]);

  const priceMajor = pickFirstNumber([
    isRecord(product.offers) ? (product.offers.price as unknown) : undefined,
    product.price,
    jsonDoc.price
  ]);

  const price = priceMinor != null
    ? Math.round(priceMinor)
    : priceMajor != null
      ? Math.round(priceMajor * (currency === 'JPY' ? 1 : 100))
      : undefined;

  const description = pickFirstString([
    product.description,
    jsonDoc.description,
    jsonDoc.raw_description
  ]);

  const color = pickFirstString([
    product.color,
    jsonDoc.color
  ]);

  const size = pickFirstString([
    product.size,
    jsonDoc.size,
    ensureArray(product.sizes)[0]
  ]) || 'M';

  const gender = pickFirstString([
    product.gender,
    jsonDoc.gender
  ]);

  const typeCategory = pickFirstString([
    product.type_category,
    jsonDoc.type_category
  ]);

  const colorGroup = pickFirstString([
    product.color_group,
    jsonDoc.color_group
  ]);

  const material = pickFirstString([
    product.material,
    jsonDoc.material
  ]);

  const care = pickFirstString([
    product.care,
    jsonDoc.care
  ]);

  const fit = pickFirstString([
    product.fit,
    jsonDoc.fit
  ]);

  const feel = pickFirstString([
    product.feel,
    jsonDoc.feel
  ]);

  const vibes = pickFirstString([
    product.vibes,
    jsonDoc.vibes
  ]);

  const descriptionText = pickFirstString([
    jsonDoc.description_text,
    product.description_text
  ]);

  const garmentSummary = asObject(jsonDoc.garment_summary ?? product.garment_summary);
  const sizeChart = asObject(jsonDoc.size_chart ?? product.size_chart);
  const productSpecifications = asObject(jsonDoc.product_specifications ?? product.product_specifications);

  const imageLength = pickFirstNumber([jsonDoc.image_length, product.image_length]);
  const productLength = pickFirstNumber([jsonDoc.product_length, product.product_length]);
  const placementX = pickFirstNumber([jsonDoc.placement_x, product.placement_x]);
  const placementY = pickFirstNumber([jsonDoc.placement_y, product.placement_y]);
  const similarItems = pickFirstString([jsonDoc.similar_items, product.similar_items]);
  const bodyPartsVisible = normalizeBodyPartsVisible(
    (product as UnknownRecord).body_parts_visible
      ?? (product as UnknownRecord).bodyPartsVisible
      ?? jsonDoc.body_parts_visible
      ?? (jsonDoc as UnknownRecord).bodyPartsVisible
  );

  const imagesRaw = ensureArray(jsonDoc.images);
  const imageUrls = uniqueStrings(
    imagesRaw.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (isRecord(entry) && typeof entry.url === 'string') return entry.url;
      return undefined;
    })
  );

  const draftImages: ExtractDraftOutputT['draft_images'] = [];

  imagesRaw.forEach((entry, index) => {
    const url = typeof entry === 'string' ? entry : isRecord(entry) ? (entry.url as unknown) : undefined;
    if (typeof url !== 'string') return;
    const record = isRecord(entry) ? entry : {};

    const kind = normalizeImageKind(record.kind) ?? null;
    const gender = typeof record.gender === 'string' && record.gender.trim() ? record.gender : null;
    const vtoEligible = typeof record.vto_eligible === 'boolean' ? record.vto_eligible : false;
    const productView = typeof record.product_view === 'string' ? (record.product_view as string).toLowerCase() : null;
    const ghostEligible = typeof record.ghost_eligible === 'boolean' ? record.ghost_eligible : false;
    const summaryEligible = typeof record.summary_eligible === 'boolean' ? record.summary_eligible : false;

    draftImages.push({
      product_id: dedupeKey,
      url,
      sort_order: index,
      is_primary: index === 0,
      kind,
      gender,
      vto_eligible: vtoEligible,
      product_view: productView ? (['front', 'back', 'side', 'detail', 'other'].includes(productView) ? (productView as 'front' | 'back' | 'side' | 'detail' | 'other') : 'other') : null,
      ghost_eligible: ghostEligible,
      summary_eligible: summaryEligible
    });
  });

  imageUrls.forEach((url, index) => {
    if (!draftImages.find((img) => img.url === url)) {
      draftImages.push({
        product_id: dedupeKey,
        url,
        sort_order: index,
        is_primary: index === 0,
        kind: null,
        gender: null,
        vto_eligible: false,
        product_view: null,
        ghost_eligible: false,
        summary_eligible: false
      });
    }
  });

  const inferredType = inferTypeFromBreadcrumbs(jsonDoc);

  const draftProduct: ExtractDraftOutputT['draft_product'] = {
    id: dedupeKey,
    type: inferredType ?? null,
    brand: brand ?? null,
    size,
    price: price ?? null,
    currency,
    image_url: imageUrls[0] ?? null,
    description: description ?? null,
    color: color ?? null,
    product_url: originalUrl,
    gender: gender ?? null,
    product_name: productName ?? null,
    type_category: typeCategory ?? null,
    color_group: colorGroup ?? null,
    category_id: null,
    size_chart: sizeChart ?? null,
    description_text: descriptionText ?? null,
    vibes: vibes ?? null,
    fit: fit ?? null,
    feel: feel ?? null,
    garment_summary: garmentSummary ?? null,
    garment_summary_version: null,
    garment_summary_front: null,
    garment_summary_back: null,
    material: material ?? null,
    care: care ?? null,
    product_specifications: productSpecifications ?? null,
    image_length: imageLength ?? null,
    product_length: productLength ?? null,
    placement_x: placementX ?? null,
    placement_y: placementY ?? null,
    body_parts_visible: bodyPartsVisible ?? null,
    similar_items: similarItems ?? null,
    vector_embedding: null,
    created_at: null,
    updated_at: null
  };

  const validations: Array<{ code: string; message: string }> = [];
  if (!brand) validations.push({ code: 'missing_brand', message: 'Brand could not be extracted' });
  if (price == null) validations.push({ code: 'missing_price', message: 'Price is missing' });
  if (!imageUrls[0]) validations.push({ code: 'missing_primary_image', message: 'Primary image not found' });
  if (!inferredType) validations.push({ code: 'missing_type', message: 'Type could not be inferred' });
  if (!description) validations.push({ code: 'missing_description', message: 'Description content is missing' });
  if (placementX == null) validations.push({ code: 'missing_placement_x', message: 'placement_x missing; defaults may affect alignment' });
  if (placementY == null) validations.push({ code: 'missing_placement_y', message: 'placement_y missing; defaults may affect alignment' });
  if (imageLength == null) validations.push({ code: 'missing_image_length', message: 'image_length missing; masking may be inaccurate' });
  if (!bodyPartsVisible) validations.push({ code: 'missing_body_parts_visible', message: 'body_parts_visible missing; mannequin masking may be incomplete' });

  const draftCandidate = {
    draft_product: draftProduct,
    draft_images: draftImages,
    validations
  } satisfies ExtractDraftOutputT;

  const parsed = ExtractDraftOutput.safeParse(draftCandidate);
  if (!parsed.success) {
    console.error('[extract-draft] Validation failed', parsed.error.flatten());
    throw new Error('extract-draft-invalid');
  }

  return parsed.data;
}
