import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerationConfig, Part } from '@google/generative-ai';
import { config } from '../../config/index';

type GeminiImageInput = {
  data: Buffer;
  mimeType?: string | null;
  filename?: string;
  altText?: string;
};

export interface GeminiImageRequest {
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  model?: string;
  garment: GeminiImageInput;
  avatar?: GeminiImageInput;
  systemInstruction?: string;
  additionalImages?: GeminiImageInput[];
}

export interface GeminiImageResponse {
  buffer: Buffer;
  mimeType: string;
  metadata?: Record<string, unknown>;
  model: string;
}

let client: GoogleGenerativeAI | undefined;

function getClient(): GoogleGenerativeAI {
  if (!client) {
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

function createInlineImagePart(input: GeminiImageInput): Part {
  const mimeType = input.mimeType ?? 'image/png';
  return {
    inlineData: {
      data: input.data.toString('base64'),
      mimeType
    }
  };
}

export async function generateGeminiImage(request: GeminiImageRequest): Promise<GeminiImageResponse> {
  const clientInstance = getClient();
  const modelName = request.model ?? 'gemini-3-pro-image-preview';

  // The SDK's `GenerationConfig` type lags behind the API surface for image models.
  // We pass the additional fields via a cast to keep TS strict elsewhere.
  const generationConfig = {
    responseModalities: ['IMAGE'],
    imageConfig: {
      ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
      ...(request.imageSize ? { imageSize: request.imageSize } : {})
    }
  } as unknown as GenerationConfig;

  const model = clientInstance.getGenerativeModel({
    model: modelName,
    systemInstruction: request.systemInstruction,
    generationConfig
  });

  const parts: Part[] = [];
  if (request.avatar) {
    parts.push(createInlineImagePart(request.avatar));
  }
  parts.push(createInlineImagePart(request.garment));
  if (request.additionalImages?.length) {
    request.additionalImages.forEach((img) => parts.push(createInlineImagePart(img)));
  }
  parts.push({ text: request.prompt });

  const response = await withGeminiRetry(() => model.generateContent({
    contents: [
      {
        role: 'user',
        parts
      }
    ]
  }));

  const candidates = response?.response?.candidates ?? [];
  if (!candidates.length) {
    throw new Error('gemini-image-empty-response');
  }

  const partsResponse = candidates[0]?.content?.parts ?? [];
  for (const part of partsResponse) {
    if ('inlineData' in part && part.inlineData?.data) {
      const buffer = Buffer.from(part.inlineData.data, 'base64');
      const mimeType = part.inlineData.mimeType ?? 'image/png';
      return {
        buffer,
        mimeType,
        metadata: (candidates[0] as unknown as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined,
        model: modelName
      };
    }
  }

  throw new Error('gemini-image-no-inline-data');
}
