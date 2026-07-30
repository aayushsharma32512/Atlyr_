import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pgPool } from '../../db/pg';
import { writePlacement2D } from '../../domain/catalog';
import { createLogger } from '../../utils/logger';

const logger = createLogger({ stage: 'api:product-placement-2d' });

const Body = z.object({
  // % of the garment's own rendered width — a wide coat shifts further than a narrow tie at the
  // same value. Bounded generously; the editor's sliders stay well inside this.
  placement_x: z.number().finite().min(-500).max(500),
  // % of the avatar's body height, measured down from the chin.
  placement_y: z.number().finite().min(-200).max(300),
  // Garment length in cm. Must be positive — 0 makes the renderer fall back to a head-scaled size,
  // which is exactly the un-placed state we are trying to leave.
  image_length: z.number().finite().positive().max(500),
});

/**
 * Legacy 2D placement save, product-keyed. Writes only placement_x / placement_y / image_length —
 * the columns the SVG avatar renders from. The 3D `placement` JSONB map is untouched by this route;
 * see POST /products/:productId/placement for that.
 *
 * Used by the /admin/placement dashboard in 2D mode.
 */
export async function registerProductPlacement2DRoute(app: FastifyInstance): Promise<void> {
  app.post('/products/:productId/placement-2d', async (req: FastifyRequest, reply: FastifyReply) => {
    const { productId } = req.params as { productId: string };

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { placement_x, placement_y, image_length } = parsed.data;

    // Confirm the product exists on either table before writing. Direct SQL — independent of PostgREST.
    const { rows } = await pgPool().query(
      `SELECT id FROM public.ingested_products WHERE id = $1
       UNION ALL
       SELECT id FROM public.products WHERE id = $1`,
      [productId],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Product not found' });

    await writePlacement2D(productId, { placement_x, placement_y, image_length });

    logger.info({ productId, placement_x, placement_y, image_length }, 'product 2D placement saved');
    return reply.send({ product_id: productId, placement_x, placement_y, image_length });
  });
}
