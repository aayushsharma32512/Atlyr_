import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pgPool } from '../../db/pg';
import { placementEntryFrom, writePlacementEntry, DEFAULT_BODY_TYPE } from '../../domain/catalog';
import { uploadToSupabase } from '../../utils/storage';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:product-placement' });

const Body = z.object({
  // Optional preview composite (1800x3072 PNG) from the mesh editor.
  image_base64: z.string().optional(),
  transform: z.object({
    scale:       z.number().finite(),
    rotationDeg: z.number().finite(),
    tx:          z.number().finite(),
    ty:          z.number().finite(),
  }),
  warp: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
  mannequin: z.enum(['male', 'female']).optional(),
  // Which body-type key inside the placement map to write; defaults to the only value used today.
  body_type: z.string().min(1).optional(),
});

/**
 * Product-keyed placement save — works for BOTH new (pipeline) and legacy (catalog-only) products,
 * since every catalog item has a product id. Writes the transform onto the catalog rows so the
 * studio renders it. Used by the /admin/placement dashboard (product-mode mesh editor).
 */
export async function registerProductPlacementRoute(app: FastifyInstance): Promise<void> {
  app.post('/products/:productId/placement', async (req: FastifyRequest, reply: FastifyReply) => {
    const { productId } = req.params as { productId: string };

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { image_base64, transform, warp, mannequin, body_type } = parsed.data;

    // Resolve the product on whichever table holds it (staging or live) to confirm it exists and
    // recover its gender for the mannequin fallback. Direct SQL — independent of PostgREST.
    const { rows } = await pgPool().query(
      `SELECT id, gender FROM public.ingested_products WHERE id = $1
       UNION ALL
       SELECT id, gender FROM public.products WHERE id = $1`,
      [productId],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Product not found' });
    const gender: string | null = (rows.find((r) => r.gender)?.gender as string | undefined) ?? null;

    // Optional preview composite — versioned path so the Supabase CDN doesn't serve a stale image.
    let placedImageUrl: string | null = null;
    if (image_base64) {
      let bytes: Buffer;
      try {
        bytes = Buffer.from(image_base64, 'base64');
      } catch {
        return reply.status(400).send({ error: 'image_base64 is not valid base64' });
      }
      if (bytes.length === 0) return reply.status(400).send({ error: 'Decoded image is empty' });
      placedImageUrl = await uploadToSupabase(`placement/${productId}/manual-${Date.now()}.png`, bytes, 'image/png');
    }

    const placement = placementEntryFrom({ transform, warp, mannequin }, gender, body_type ?? DEFAULT_BODY_TYPE);
    if (!placement) return reply.status(422).send({ error: 'transform is missing required numeric fields' });
    await writePlacementEntry(productId, placement.key, placement.entry);

    logger.info({ productId, key: placement.key }, 'product placement saved');
    return reply.send({ product_id: productId, key: placement.key, placement: placement.entry, placed_image_url: placedImageUrl });
  });
}
