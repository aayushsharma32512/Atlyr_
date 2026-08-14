// @google/genai transport for the route router.
//
// The same SDK reaches both quota pools — the constructor flag is the only difference:
//   ai_studio → new GoogleGenAI({ apiKey })                       (generativelanguage.googleapis.com)
//   vertex    → new GoogleGenAI({ vertexai, project, location })  (aiplatform.googleapis.com, ADC)
//
// Vertex auth is Application Default Credentials: set GOOGLE_APPLICATION_CREDENTIALS to the
// service-account JSON key path locally, or use workload identity in deploy. Model IDs are
// identical on both sides.

import { GoogleGenAI } from '@google/genai';
import { config } from '../../config/index';
import type { LlmRoute } from './route-spec';
import type { GeminiRequest, GeminiResponse, RouteTransport } from './router';

// Must clear the slowest legitimate call with margin: gemini-3-pro-image at 2K measures 104-155s.
// At 120s the client aborted mid-generation (surfacing as 499 CANCELLED / 504) for work that was
// on track to succeed — and had possibly already been billed server-side.
const REQUEST_TIMEOUT_MS = 240_000;

const clients = new Map<string, GoogleGenAI>();

function clientFor(route: LlmRoute): GoogleGenAI {
  let client = clients.get(route.id);
  if (client) return client;

  if (route.kind === 'ai_studio') {
    if (!config.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set (route ai_studio)');
    client = new GoogleGenAI({
      apiKey: config.GOOGLE_API_KEY,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS },
    });
  } else {
    if (!config.GOOGLE_VERTEX_PROJECT) throw new Error(`GOOGLE_VERTEX_PROJECT is not set (route ${route.id})`);
    client = new GoogleGenAI({
      vertexai: true,
      project: config.GOOGLE_VERTEX_PROJECT,
      location: route.location,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS },
    });
  }

  clients.set(route.id, client);
  return client;
}

export const geminiTransport: RouteTransport = async (route, model, req: GeminiRequest): Promise<GeminiResponse> => {
  const client = clientFor(route);

  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts: req.parts }],
    config: {
      ...(req.systemInstruction ? { systemInstruction: req.systemInstruction } : {}),
      ...(req.generationConfig ?? {}),
    },
  });

  const candidate = response.candidates?.[0];
  return {
    parts: (candidate?.content?.parts ?? []) as GeminiResponse['parts'],
    usageMetadata: response.usageMetadata as Record<string, number> | undefined,
    finishReason: candidate?.finishReason as string | undefined,
  };
};
