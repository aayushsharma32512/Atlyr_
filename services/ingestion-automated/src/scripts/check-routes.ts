/**
 * Route health check for the multi-route Gemini transport.
 *
 *   bun run src/scripts/check-routes.ts            # cheap text call per configured route
 *   bun run src/scripts/check-routes.ts --image    # ALSO one image generation per route (~$0.13 each)
 *
 * Run from services/ingestion-automated so its .env is loaded. Each configured route is called
 * DIRECTLY (no failover), so a broken route reports its own error instead of silently falling
 * through to a healthy one. Use after wiring a new route (e.g. Vertex) to prove auth, project,
 * location and model availability before any pipeline traffic rides on it.
 */
import { config } from '../config/index';
import { parseRoutes } from '../adapters/llm/route-spec';
import { geminiTransport } from '../adapters/llm/gemini-transport';

const checkImage = process.argv.includes('--image');

const routes = parseRoutes(config.GEMINI_ROUTES);
console.log(`\nConfigured routes: ${routes.map((r) => r.id).join(', ')}`);
console.log(`Text model: ${config.GEMINI_TEXT_MODEL}${checkImage ? ` · Image model: ${config.GEMINI_IMAGE_MODEL}` : ''}\n`);

let failures = 0;

for (const route of routes) {
  // Text: near-free, proves auth + project + endpoint reachability.
  const t0 = Date.now();
  try {
    const res = await geminiTransport(route, config.GEMINI_TEXT_MODEL, {
      models: [config.GEMINI_TEXT_MODEL],
      parts: [{ text: 'Reply with exactly: OK' }],
    });
    const text = res.parts.map((p) => p.text ?? '').join('').trim();
    const tokens = res.usageMetadata?.totalTokenCount ?? '?';
    console.log(`  ${route.id.padEnd(24)} text   OK  ${Date.now() - t0}ms  "${text.slice(0, 20)}"  (${tokens} tokens)`);
  } catch (err) {
    failures += 1;
    console.log(`  ${route.id.padEnd(24)} text   FAIL  ${Date.now() - t0}ms\n    ${(err as Error).message.slice(0, 300)}`);
    continue; // no point burning an image call on a route whose text call failed
  }

  if (!checkImage) continue;

  // Image: proves the image model is actually served in this route's location.
  const t1 = Date.now();
  try {
    const res = await geminiTransport(route, config.GEMINI_IMAGE_MODEL, {
      models: [config.GEMINI_IMAGE_MODEL],
      parts: [{ text: 'Generate a plain solid light-grey square.' }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    });
    const img = res.parts.find((p) => p.inlineData)?.inlineData;
    console.log(
      img
        ? `  ${route.id.padEnd(24)} image  OK  ${Date.now() - t1}ms  (${img.mimeType}, ${Math.round(img.data.length * 0.75 / 1024)} KB)`
        : `  ${route.id.padEnd(24)} image  FAIL  no image part (finishReason=${res.finishReason ?? 'unknown'})`,
    );
    if (!img) failures += 1;
  } catch (err) {
    failures += 1;
    console.log(`  ${route.id.padEnd(24)} image  FAIL  ${Date.now() - t1}ms\n    ${(err as Error).message.slice(0, 300)}`);
  }
}

console.log(failures === 0 ? '\nAll routes healthy.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
