import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOutfitEnrichmentPrompt, normalizeOutfitEnrichmentOutput, OUTFIT_SYSTEM_INSTRUCTION } from '../config/outfitEnrichmentPrompt';
import { GoogleGenerativeAI } from '@google/generative-ai';

function getGeminiApiKey(): string {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('missing-google-api-key: set GOOGLE_API_KEY (or GEMINI_API_KEY)');
  }
  return key;
}

async function generateJsonWithGemini(options: {
  prompt: string;
  systemInstruction: string;
  model?: string;
  images: Array<{ data: Buffer; mimeType: string; altText?: string }>;
}): Promise<{ json: unknown; raw: string; model: string }> {
  const apiKey = getGeminiApiKey();
  const modelName = options.model ?? 'gemini-2.5-flash';
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: modelName,
    systemInstruction: options.systemInstruction,
    generationConfig: { responseMimeType: 'application/json' },
  });

  const parts: any[] = [];
  parts.push({ text: options.prompt });
  for (const image of options.images) {
    parts.push({
      inlineData: {
        data: image.data.toString('base64'),
        mimeType: image.mimeType || 'image/png',
      },
    });
    if (image.altText) parts.push({ text: image.altText });
  }

  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
  } as any);

  const text = result.response?.text?.() || '';
  const normalized = text.trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(normalized) as unknown;
  return { json: parsed, raw: text, model: modelName };
}

type CliOptions = {
  images: string[];
  out: string;
  model?: string;
  dryRun: boolean;
  showPrompt: boolean;
  showSystem: boolean;
  gender?: string;
  fit?: string;
  feel?: string;
  wordAssociation?: string;
  occasion?: string;
  category?: string;
  description?: string;
  vibes?: string;
};

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
run-outfit-enrichment

Generate outfit enrichment JSON from outfit photo(s) + optional attributes.

Usage:
  bun run src/scripts/run-outfit-enrichment.ts --image <path> [--image <path> ...] [options]

Required:
  --image <path>                Local image path (repeatable)

Options (all optional):
  --gender <text>
  --fit <text>
  --feel <text>
  --word-association <text>
  --occasion <text>
  --category <text>
  --description <text>
  --vibes <text>
  --out <file>                  Output file (default: outfit_enrichment.json)
  --model <name>                Gemini model override
  --show-prompt                 Print the formatted prompt
  --show-system                 Print the system instruction
  --dry-run                     Print prompt and exit without calling Gemini
  -h, --help                    Show this help
`);
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = {
    images: [],
    out: 'outfit_enrichment.json',
    dryRun: false,
    showPrompt: false,
    showSystem: false,
  };

  const takeValue = (arg: string, next: string | undefined): string => {
    if (arg.includes('=')) {
      const [, value] = arg.split(/=(.*)/s);
      if (!value) throw new Error(`missing-value:${arg}`);
      return value;
    }
    if (!next) throw new Error(`missing-value:${arg}`);
    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--show-prompt') {
      opts.showPrompt = true;
      continue;
    }
    if (arg === '--show-system') {
      opts.showSystem = true;
      continue;
    }

    if (arg === '--image' || arg.startsWith('--image=')) {
      const value = takeValue(arg, next);
      opts.images.push(value);
      if (arg === '--image') i += 1;
      continue;
    }

    if (arg === '--gender' || arg.startsWith('--gender=')) {
      opts.gender = takeValue(arg, next);
      if (arg === '--gender') i += 1;
      continue;
    }

    if (arg === '--out' || arg.startsWith('--out=')) {
      opts.out = takeValue(arg, next);
      if (arg === '--out') i += 1;
      continue;
    }

    if (arg === '--model' || arg.startsWith('--model=')) {
      opts.model = takeValue(arg, next);
      if (arg === '--model') i += 1;
      continue;
    }

    if (arg === '--fit' || arg.startsWith('--fit=')) {
      opts.fit = takeValue(arg, next);
      if (arg === '--fit') i += 1;
      continue;
    }

    if (arg === '--feel' || arg.startsWith('--feel=')) {
      opts.feel = takeValue(arg, next);
      if (arg === '--feel') i += 1;
      continue;
    }

    if (arg === '--word-association' || arg.startsWith('--word-association=')) {
      opts.wordAssociation = takeValue(arg, next);
      if (arg === '--word-association') i += 1;
      continue;
    }

    if (arg === '--occasion' || arg.startsWith('--occasion=')) {
      opts.occasion = takeValue(arg, next);
      if (arg === '--occasion') i += 1;
      continue;
    }

    if (arg === '--category' || arg.startsWith('--category=')) {
      opts.category = takeValue(arg, next);
      if (arg === '--category') i += 1;
      continue;
    }

    if (arg === '--description' || arg.startsWith('--description=')) {
      opts.description = takeValue(arg, next);
      if (arg === '--description') i += 1;
      continue;
    }

    if (arg === '--vibes' || arg.startsWith('--vibes=')) {
      opts.vibes = takeValue(arg, next);
      if (arg === '--vibes') i += 1;
      continue;
    }

    throw new Error(`unknown-arg:${arg}`);
  }

  if (opts.images.length === 0) {
    throw new Error('missing-required-arg:--image');
  }

  return opts;
}

function toMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

async function main() {
  const opts = parseCli(process.argv.slice(2));

  const prompt = buildOutfitEnrichmentPrompt({
    genderInput: opts.gender,
    categoryInput: opts.category,
    occasionInput: opts.occasion,
    description: opts.description,
  });
  if (opts.showSystem) {
    // eslint-disable-next-line no-console
    console.log('=== Outfit System Instruction ===\n' + OUTFIT_SYSTEM_INSTRUCTION + '\n=== End System Instruction ===\n');
  }
  if (opts.showPrompt || opts.dryRun) {
    // eslint-disable-next-line no-console
    console.log('=== Outfit Enrichment Prompt ===\n' + prompt + '\n=== End Prompt ===\n');
  }
  if (opts.dryRun) return;

  const images = await Promise.all(
    opts.images.map(async (imgPath, idx) => {
      const abs = path.resolve(imgPath);
      const data = await readFile(abs);
      return {
        data,
        mimeType: toMimeType(abs),
        altText: `Outfit photo ${idx + 1}`,
      };
    })
  );

  const response = await generateJsonWithGemini({
    prompt,
    systemInstruction: OUTFIT_SYSTEM_INSTRUCTION,
    model: opts.model,
    images,
  });

  const output = normalizeOutfitEnrichmentOutput(response.json);

  await writeFile(opts.out, JSON.stringify(output, null, 2), 'utf-8');

  // eslint-disable-next-line no-console
  console.log(`Saved outfit enrichment JSON to ${opts.out}`);
  // eslint-disable-next-line no-console
  console.log('Key fields:', {
    outfit_name: output.outfit_name,
    ui_category: output.ui_category,
    ui_occasion: output.ui_occasion,
    analyzed_occasions: output.analyzed_occasions,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`run-outfit-enrichment failed: ${message}`);
  process.exit(1);
});

