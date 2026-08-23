import { config } from '../../config/index';
import { readUsage } from '../gemini';
import { geminiRouter } from '../llm/index';
import { buildVtonRequest, fetchImageAsBase64, vtonGenerationConfig } from './vton-request';
import type { TryonInput, TryonOutput, TryonProvider } from '../../domain/types';

// Primary image model + fallbacks, tried in order when one is overloaded (503) or missing (404).
function imageModelCandidates(): string[] {
  const fallbacks = config.GEMINI_IMAGE_MODEL_FALLBACKS.split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([config.GEMINI_IMAGE_MODEL, ...fallbacks])];
}

export const geminiVtonProvider: TryonProvider = {
  name: 'gemini_nano_banana',

  async run(input: TryonInput): Promise<TryonOutput> {
    // Prompt, avatar and generation config come from the shared builder so the economy-lane
    // collector packs byte-identical requests into its batch trays.
    const spec = buildVtonRequest(input);
    const garment = await fetchImageAsBase64(input.imageUrl);

    const start = Date.now();

    // Route failover, model fallback, 429 handling and per-route concurrency all live in the
    // router — this adapter only assembles the request and unpacks the image.
    const { response, routeUsed, modelUsed, attempted } = await geminiRouter().call({
      models: imageModelCandidates(),
      parts: [
        { inlineData: { mimeType: spec.avatar.mimeType, data: spec.avatar.b64 } },
        { inlineData: { mimeType: garment.mimeType, data: garment.b64 } },
        { text: spec.prompt },
      ],
      systemInstruction: spec.system,
      // A 200 with no image (finishReason=IMAGE_SAFETY on e.g. camis/lingerie-adjacent garments)
      // walks the model chain and then the route chain instead of failing the job — safety
      // filters are tuned differently per model and per endpoint, so a sibling often passes.
      expectImage: true,
      // Validated VTON recipe — deterministic output (temperature 0) so the model faithfully
      // dresses the base avatar instead of regurgitating the reference model, at portrait 9:16 / 2K.
      // Taken from the shared builder so this lane and the batch collector cannot drift apart.
      generationConfig: {
        ...vtonGenerationConfig(),
        // This is catalogue clothing on a neutral base avatar; block only high-severity content
        // instead of the default threshold that false-positives on fitted/strappy womenswear.
        safetySettings: [
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      },
    });

    const imagePart = response.parts.find((p) => p.inlineData)?.inlineData;
    if (!imagePart) {
      throw new Error(`${modelUsed}: no image in response (finishReason=${response.finishReason ?? 'unknown'})`);
    }

    return {
      bytes: Buffer.from(imagePart.data, 'base64'),
      mimeType: imagePart.mimeType,
      inferenceMs: Date.now() - start,
      modelUsed,
      routeUsed,
      attempted,
      usage: readUsage(response.usageMetadata),
    };
  },
};
