import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerationConfig, Part } from '@google/generative-ai';
import { config } from '../../config/index';

const DEFAULT_MODEL = config.GEMINI_TEXT_MODEL;

type GeminiImageInput = {
  data: Buffer;
  mimeType?: string | null;
  altText?: string;
};

export interface GeminiJsonOptions {
  prompt: string;
  systemInstruction?: string;
  model?: string;
  images?: GeminiImageInput[];
  generationConfig?: GenerationConfig;
}

export interface GeminiJsonResult<T = unknown> {
  json: T;
  raw: string;
  model: string;
}

export interface GeminiTextResult {
  text: string;
  model: string;
}

let client: GoogleGenerativeAI | undefined;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    if (!config.GOOGLE_API_KEY) {
      throw new Error('missing-google-api-key');
    }
    console.log('[Aayush] Creating GoogleGenerativeAI client with key:', config.GOOGLE_API_KEY.substring(0, 10) + '...');
    client = new GoogleGenerativeAI(config.GOOGLE_API_KEY);
  }
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldRetryGeminiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|503|overloaded|rate limit|temporarily unavailable/i.test(message);
}

function computeRetryDelayMs(attempt: number): number {
  const base = Math.max(0, config.LLM_RETRY_BASE_MS);
  const max = Math.max(base, config.LLM_RETRY_MAX_MS);
  const raw = base * Math.pow(2, attempt);
  const jitter = Math.floor(raw * 0.2 * Math.random());
  return Math.min(max, raw + jitter);
}

async function withGeminiRetry<T>(action: () => Promise<T>): Promise<T> {
  const maxAttempts = Math.max(1, config.LLM_RETRY_LIMIT);
  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!shouldRetryGeminiError(error) || attempt >= maxAttempts - 1) {
        throw error;
      }
      const delayMs = computeRetryDelayMs(attempt);
      await sleep(delayMs);
      attempt += 1;
    }
  }
  throw lastError;
}

function normalizeJsonText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed
      .replace(/^```json/i, '')
      .replace(/^```/i, '')
      .replace(/```$/i, '');
    return withoutFence.trim();
  }
  return trimmed;
}

function toInlineImagePart(image: GeminiImageInput): Part {
  const mimeType = image.mimeType?.trim() || 'image/png';
  return {
    inlineData: {
      data: image.data.toString('base64'),
      mimeType
    }
  };
}

export async function generateGeminiJson<T = unknown>(options: GeminiJsonOptions): Promise<GeminiJsonResult<T>> {
  const clientInstance = getClient();
  const modelName = options.model ?? DEFAULT_MODEL;
  console.log('[Aayush] generateGeminiJson: requesting model:', modelName);

  const generationConfig: GenerationConfig = {
    responseMimeType: 'application/json',
    ...(options.generationConfig ?? {})
  };

  const model = clientInstance.getGenerativeModel({
    model: modelName,
    systemInstruction: options.systemInstruction,
    generationConfig
  });

  const parts: Part[] = [];
  parts.push({ text: options.prompt });
  if (options.images?.length) {
    for (const image of options.images) {
      parts.push(toInlineImagePart(image));
      if (image.altText) {
        parts.push({ text: image.altText });
      }
    }
  }

  const response = await withGeminiRetry(() => model.generateContent({
    contents: [
      {
        role: 'user',
        parts
      }
    ]
  }));

  const candidates = response?.response?.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('gemini-empty-response');
  }

  const first = candidates[0]?.content?.parts ?? [];
  const raw = first
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!raw) {
    throw new Error('gemini-no-text');
  }

  const normalized = normalizeJsonText(raw);
  try {
    const parsed = JSON.parse(normalized) as T;
    return { json: parsed, raw, model: modelName };
  } catch (error) {
    const err = error as Error;
    throw new Error(`gemini-json-parse-failed:${err.message}`);
  }
}

export async function generateGeminiText(options: GeminiJsonOptions): Promise<GeminiTextResult> {
  const clientInstance = getClient();
  const modelName = options.model ?? DEFAULT_MODEL;
  console.log('[Aayush] generateGeminiText: requesting model:', modelName);

  const generationConfig: GenerationConfig = {
    ...(options.generationConfig ?? {})
  };

  const model = clientInstance.getGenerativeModel({
    model: modelName,
    systemInstruction: options.systemInstruction,
    generationConfig
  });

  const parts: Part[] = [];
  if (options.images?.length) {
    for (const image of options.images) {
      parts.push(toInlineImagePart(image));
      if (image.altText) {
        parts.push({ text: image.altText });
      }
    }
  }
  parts.push({ text: options.prompt });

  const response = await withGeminiRetry(() => model.generateContent({
    contents: [
      {
        role: 'user',
        parts
      }
    ]
  }));

  const candidates = response?.response?.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('gemini-empty-response');
  }

  const first = candidates[0]?.content?.parts ?? [];
  const raw = first
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!raw) {
    throw new Error('gemini-no-text');
  }

  return { text: raw, model: modelName };
}
