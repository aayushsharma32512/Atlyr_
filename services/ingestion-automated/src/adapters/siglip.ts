import { config } from '../config/index';
import { withRetry } from '../utils/retry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GarmentCategory = 'topwear' | 'bottomwear' | 'dress';
export type Gender = 'male' | 'female' | 'unisex';

export interface ImageClassification {
  imageUrl: string;
  category: string;
  stage1Winner: string;
  stage1Labels: string[];
  stage1Probs: number[];
  stage2Winner: string | null;
  stage2Labels: string[] | null;
  stage2Probs: number[] | null;
  stage1Uncertain: boolean;
  stage2Uncertain: boolean;
}

// ---------------------------------------------------------------------------
// Prompts — edit these freely, no Modal redeploy needed
// ---------------------------------------------------------------------------

const TERMS: Record<GarmentCategory, { piece: string; item: string }> = {
  topwear:    { piece: 'topwear',    item: 'upper-body garment' },
  bottomwear: { piece: 'bottomwear', item: 'lower-body garment' },
  dress:      { piece: 'dress',      item: 'dress' },
};

function genderedPhrases(phrases: string[], gender: string): string[] {
  if (gender === 'unisex') return phrases;
  const q = gender === 'mens' ? "men's" : "women's";
  return phrases.map(p => p.startsWith('a ') ? `a ${q} ${p.slice(2)}` : `${q} ${p}`);
}

function stage1Config(cat: GarmentCategory): Array<{ name: string; phrases: string[] }> {
  const t = TERMS[cat];
  return [
    {
      name: 'Flat Lay',
      phrases: [
        `a product photo of a ${t.item} laid flat on a background or floating`,
        `an isolated flat lay shot of a ${t.piece}`,
        `e-commerce packshot of a ${t.piece} without a model`,
        `ghost mannequin or flat layout of an unworn ${t.item} on a plain studio background`,
      ],
    },
    {
      name: 'Live Model',
      phrases: [
        `a model wearing a ${t.item}`,
        `a full shot of a ${t.piece} with a visible model body`,
        `an e-commerce catalog photo of a model in a ${t.piece}`,
        `fashion model wearing a ${t.item} lifestyle portrait`,
      ],
    },
    {
      name: 'Macro Detail',
      phrases: [
        `a cropped close-up shot focusing on ${t.item} fabric print embroidery or neckline detail`,
        `a close-up shot of clothing material stitching weave or hem finish`,
        `a zoomed-in fabric swatch or localized detail of a ${t.piece}`,
      ],
    },
  ];
}

function stage2Config(
  cat: GarmentCategory,
  stage1Type: 'Flat Lay' | 'Live Model',
): { groups: Array<{ name: string; phrases: string[] }>; labels: string[] } {
  const t = TERMS[cat];

  if (stage1Type === 'Flat Lay') {
    if (cat === 'topwear') return {
      labels: ['Front', 'Back'],
      groups: [
        { name: 'Front', phrases: [
          `the front panel chest view of a flat lay ${t.item}`,
          `flat lay front side of ${t.item} displaying front buttons or zips or graphic print or chest artwork or design features`,
          `a flat lay ${t.item} facing up showing the front neck collar opening drop or logo on the front or shoulder opening`,
        ]},
        { name: 'Back', phrases: [
          `the back panel of a flat lay ${t.item}`,
          `flat layout of the back side of a ${t.item}`,
          `back view of a flat lay ${t.item} where the fabric completely covers the neck opening with a single high seam arch`,
        ]},
      ],
    };
    if (cat === 'dress') return {
      labels: ['Front', 'Back'],
      groups: [
        { name: 'Front', phrases: [
          `the front bodice and neckline view of a flat lay ${t.item}`,
          `flat lay front of ${t.item} displaying neckline waist seam or front design panel`,
          `a flat lay ${t.item} facing up showing the front neck opening or front closure`,
        ]},
        { name: 'Back', phrases: [
          `the back panel of a flat lay ${t.item}`,
          `flat layout of the back side of a ${t.item} showing rear neckline or back zip`,
          `back view of a flat lay ${t.item} with a plain reverse bodice panel`,
        ]},
      ],
    };
    // bottomwear
    return {
      labels: ['Front', 'Back'],
      groups: [
        { name: 'Front', phrases: [
          `the front panel view of a flat lay ${t.item}`,
          `flat layout of ${t.item} with dropping waistband`,
        ]},
        { name: 'Back', phrases: [
          `the back panel view of a flat lay ${t.item}`,
          `flat layout of ${t.item} with horizontal waistband`,
        ]},
      ],
    };
  }

  // Live Model - all categories use Front/Back/Side
  return {
    labels: ['Front', 'Back', 'Side'],
    groups: [
      { name: 'Front', phrases: [
        `the front view of a ${t.item}`,
        `a model facing front wearing a ${t.piece}`,
      ]},
      { name: 'Back', phrases: [
        `the back view of a ${t.item}`,
        `a model facing back wearing a ${t.piece}`,
      ]},
      { name: 'Side', phrases: [
        `the side profile of a ${t.item}`,
        `a model facing sideways wearing a ${t.piece}`,
      ]},
    ],
  };
}

// ---------------------------------------------------------------------------
// Math (ported from Python — no external deps needed)
// ---------------------------------------------------------------------------

const LOGIT_SCALE = 100.0; // google/siglip-so400m-patch14-384 constant
const UNCERTAIN_MARGIN = 0.05;

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

function softmax(sims: number[], scale: number): number[] {
  const scaled = sims.map(s => s * scale);
  const max = Math.max(...scaled);
  const exps = scaled.map(s => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

function winner(probs: number[]): { idx: number; margin: number } {
  const ranked = [...probs.entries()].sort((a, b) => b[1] - a[1]);
  return { idx: ranked[0][0], margin: ranked[0][1] - ranked[1][1] };
}

// ---------------------------------------------------------------------------
// Text anchor cache — computed once per (category, gender) on first use
// ---------------------------------------------------------------------------

type AnchorKey = string;
// Cache the in-flight promise (not the resolved value) so concurrent callers
// for the same key await one shared request instead of each firing their own.
const anchorCache = new Map<AnchorKey, Promise<number[]>>();

function getAnchor(phrases: string[]): Promise<number[]> {
  const key = phrases.join('|');
  if (!anchorCache.has(key)) anchorCache.set(key, embedTexts(phrases));
  return anchorCache.get(key)!;
}

// ---------------------------------------------------------------------------
// Modal HTTP calls
// ---------------------------------------------------------------------------

// TODO: Aayush — these fire once per image, concurrently (see identifying.handler.ts).
// A burst of images in one job can force several parallel Modal cold starts.
// Batch embedImage/embedTexts into a single multi-item request to SigLIPEmbed
// instead, so one job pays for at most one cold start.
async function callModal(payload: Record<string, unknown>): Promise<{ vector: number[] }> {
  if (!config.SIGLIP_ENDPOINT) throw new Error('SIGLIP_ENDPOINT is not set');

  return withRetry(async () => {
    const resp = await fetch(config.SIGLIP_ENDPOINT!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`SigLIP ${resp.status}: ${await resp.text()}`);
    return resp.json() as Promise<{ vector: number[] }>;
  }, { retries: 2, backoffMs: 1000 });
}

async function embedImage(imageUrl: string): Promise<number[]> {
  const buf = await fetch(imageUrl).then(r => r.arrayBuffer());
  const image_b64 = Buffer.from(buf).toString('base64');
  const { vector } = await callModal({ image_b64 });
  return vector;
}

async function embedTexts(phrases: string[]): Promise<number[]> {
  const { vector } = await callModal({ phrases });
  return vector;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export async function classifyImage(
  imageUrl: string,
  garmentCategory: GarmentCategory,
  gender: Gender,
): Promise<ImageClassification> {
  const gParam = gender === 'male' ? 'mens' : gender === 'female' ? 'womens' : 'unisex';

  // Get image vector
  const imgVec = await embedImage(imageUrl);

  // Stage 1 anchors
  const s1Cfg = stage1Config(garmentCategory);
  const s1Vecs = await Promise.all(
    s1Cfg.map(c => getAnchor(genderedPhrases(c.phrases, gParam))),
  );

  const s1Sims = s1Vecs.map(v => dot(imgVec, v));
  const s1Probs = softmax(s1Sims, LOGIT_SCALE);
  const s1 = winner(s1Probs);
  const s1Name = s1Cfg[s1.idx].name;
  const s1Uncertain = s1.margin < UNCERTAIN_MARGIN;

  if (s1Name === 'Macro Detail') {
    return {
      imageUrl, category: 'Macro Detail',
      stage1Winner: s1Name, stage1Labels: s1Cfg.map(c => c.name), stage1Probs: s1Probs,
      stage2Winner: null, stage2Labels: null, stage2Probs: null,
      stage1Uncertain: s1Uncertain, stage2Uncertain: false,
    };
  }

  // Stage 2 anchors
  const s2Type = s1Name === 'Flat Lay' ? 'Flat Lay' : 'Live Model';
  const s2Cfg = stage2Config(garmentCategory, s2Type);
  const s2Vecs = await Promise.all(
    s2Cfg.groups.map(g => getAnchor(genderedPhrases(g.phrases, gParam))),
  );

  const s2Sims = s2Vecs.map(v => dot(imgVec, v));
  const s2Probs = softmax(s2Sims, LOGIT_SCALE);
  const s2 = winner(s2Probs);
  const s2Name = s2Cfg.labels[s2.idx];
  const s2Uncertain = s2.margin < UNCERTAIN_MARGIN;

  return {
    imageUrl,
    category: `${s1Name} (${s2Name})`,
    stage1Winner: s1Name, stage1Labels: s1Cfg.map(c => c.name), stage1Probs: s1Probs,
    stage2Winner: s2Name, stage2Labels: s2Cfg.labels, stage2Probs: s2Probs,
    stage1Uncertain: s1Uncertain, stage2Uncertain: s2Uncertain,
  };
}

// ---------------------------------------------------------------------------
// VTON selection
// ---------------------------------------------------------------------------

const VTON_PRIORITY: Array<{ stage1: string; stage2: string }> = [
  { stage1: 'Flat Lay',   stage2: 'Front' },
  { stage1: 'Live Model', stage2: 'Front' },
  { stage1: 'Flat Lay',   stage2: 'Back'  },
  { stage1: 'Live Model', stage2: 'Side'  },
  { stage1: 'Live Model', stage2: 'Back'  },
];

export function selectVtonImage(
  classifications: ImageClassification[],
  preference: { type: string } | null,
): ImageClassification | null {
  if (classifications.length === 0) return null;

  if (preference?.type === 'flat_lay') {
    const match = classifications.find(c => c.stage1Winner === 'Flat Lay' && c.stage2Winner === 'Front');
    if (match) return match;
  }

  for (const { stage1, stage2 } of VTON_PRIORITY) {
    const match = classifications.find(c => c.stage1Winner === stage1 && c.stage2Winner === stage2);
    if (match) return match;
  }

  return classifications.find(c => c.stage1Winner !== 'Macro Detail') ?? classifications[0];
}

// ---------------------------------------------------------------------------
// 4-slot selection (Front·Model, Front·Flat, Back·Model, Back·Flat) with HITL override
// ---------------------------------------------------------------------------
//
// This sits alongside selectVtonImage above (kept as the fallback for jobs where no
// image lands in any of the 4 named slots — e.g. only Side / Macro Detail shots exist).

export type SlotKey = 'front_model' | 'front_flat' | 'back_model' | 'back_flat';
export const SLOT_KEYS: SlotKey[] = ['front_model', 'front_flat', 'back_model', 'back_flat'];

export interface SlotPick {
  publicUrl: string;
  uncertain: boolean;
  manual: boolean;
}

export type SlotMapResult = Record<SlotKey, SlotPick | null>;

// One row per image, using its *effective* verdict — the human override if one has been
// applied (see image_classification.data.user_override), otherwise SigLIP's own winner.
export interface ClassificationInput {
  imageUrl: string;
  stage1: string | null; // 'Flat Lay' | 'Live Model' | 'Macro Detail' | null
  stage2: string | null; // 'Front' | 'Back' | 'Side' | null
  score: number;         // the stage2 winning probability ("the back %") — ranks candidates within a bucket
  uncertain: boolean;
  manual: boolean;
  overriddenAt: string | null; // ISO timestamp; set only when manual
}

// The stage2 probability of whatever stage2 actually won — e.g. "the back %" when
// stage2Winner is 'Back'. 0 when there's nothing to rank (no stage2 axis, e.g. Macro Detail).
export function winningScore(labels: string[] | null | undefined, probs: number[] | null | undefined, winner: string | null | undefined): number {
  if (!labels || !probs || !winner) return 0;
  const idx = labels.indexOf(winner);
  return idx >= 0 ? probs[idx] : 0;
}

function slotKeyFor(stage1: string | null, stage2: string | null): SlotKey | null {
  if (stage2 !== 'Front' && stage2 !== 'Back') return null; // Side / Macro Detail never fill a slot
  if (stage1 === 'Live Model') return stage2 === 'Front' ? 'front_model' : 'back_model';
  if (stage1 === 'Flat Lay')   return stage2 === 'Front' ? 'front_flat'  : 'back_flat';
  return null;
}

// Manual always outranks auto. Between two manual tags on the same slot (someone changed
// their mind about which photo is primary), the latest one wins. Between two auto
// candidates, the one with the higher "winning %" wins — not just "confident vs not."
function isBetter(candidate: ClassificationInput, existing: ClassificationInput): boolean {
  if (candidate.manual !== existing.manual) return candidate.manual;
  if (candidate.manual) return (candidate.overriddenAt ?? '') > (existing.overriddenAt ?? '');
  return candidate.score > existing.score;
}

export function buildSlots(items: ClassificationInput[]): SlotMapResult {
  const slots: SlotMapResult = { front_model: null, front_flat: null, back_model: null, back_flat: null };
  const winners: Partial<Record<SlotKey, ClassificationInput>> = {};

  for (const item of items) {
    const key = slotKeyFor(item.stage1, item.stage2);
    if (!key) continue;
    const existing = winners[key];
    if (!existing || isBetter(item, existing)) winners[key] = item;
  }

  for (const key of SLOT_KEYS) {
    const w = winners[key];
    slots[key] = w ? { publicUrl: w.imageUrl, uncertain: w.uncertain, manual: w.manual } : null;
  }

  return slots;
}

// No preference set → default to a model shot, not flat lay.
const PREFERRED_ORDER: Record<string, SlotKey[]> = {
  model:    ['front_model', 'back_model', 'front_flat', 'back_flat'],
  flat_lay: ['front_flat', 'back_flat', 'front_model', 'back_model'],
};

export function pickPreferredSlot(slots: SlotMapResult, preferenceType: string | null | undefined): SlotKey | null {
  const order = PREFERRED_ORDER[preferenceType ?? 'model'] ?? PREFERRED_ORDER.model;
  for (const key of order) if (slots[key]) return key;
  return null;
}

export const SLOT_LABEL: Record<SlotKey, string> = {
  front_model: 'Front · Model',
  front_flat:  'Front · Flat Lay',
  back_model:  'Back · Model',
  back_flat:   'Back · Flat Lay',
};
