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
