import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import type { BossHandle } from '../queue/boss';
import { supabaseAdmin } from '../db/supabase';
import { registerSubmitRoute } from './routes/submit';
import { registerBatchRoutes } from './routes/batches';
import { registerStatusRoutes } from './routes/status';
import { registerProceedRoute } from './routes/proceed';
import { registerRestartRoute } from './routes/restart';
import { registerRecoverRoute } from './routes/recover';
import { registerRetagRoute } from './routes/retag';
import { registerDeletePhotoRoute } from './routes/delete-photo';
import { registerDetailsRoute } from './routes/details';
import { registerManualAssetRoutes } from './routes/manual-assets';
import { registerSegmentedImageRoute } from './routes/segmented-image';
import { registerPlacementRoute } from './routes/placement';
import { registerProductPlacementRoute } from './routes/product-placement';
import { registerProductPlacement2DRoute } from './routes/product-placement-2d';
import { registerPublishRoute } from './routes/publish';
import { registerDeleteRoute } from './routes/delete';
import { registerVtonBatchRoutes } from './routes/vton-batch';

// Same requireUser + profiles.role='admin' gate as _shared/auth.ts, ported from Deno to Fastify.
async function requireAdmin(
  req: { headers: Record<string, string | string[] | undefined> },
): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const header = req.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  const token = value?.startsWith('Bearer ') ? value.slice(7) : null;
  if (!token) return { ok: false, status: 401 };

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401 };

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  if (profile?.role !== 'admin') return { ok: false, status: 403 };

  return { ok: true };
}

export async function buildApp(boss: BossHandle) {
  // 25 MB: manual placement saves POST a full 1800x3072 PNG as base64, which inflates ~33%.
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });

  await app.register(fastifyCors, {
    origin: ['https://atlyr.app', 'http://localhost:8080'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const result = await requireAdmin(req as never);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.status === 403 ? 'Forbidden' : 'Unauthorized' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  await registerSubmitRoute(app, boss);
  await registerBatchRoutes(app, boss);
  await registerStatusRoutes(app);
  await registerProceedRoute(app, boss);
  await registerRestartRoute(app, boss);
  await registerRecoverRoute(app, boss);
  await registerRetagRoute(app);
  await registerDeletePhotoRoute(app);
  await registerDetailsRoute(app);
  await registerSegmentedImageRoute(app);
  await registerManualAssetRoutes(app);
  await registerPlacementRoute(app);
  await registerProductPlacementRoute(app);
  await registerProductPlacement2DRoute(app);
  await registerPublishRoute(app);
  await registerDeleteRoute(app);
  await registerVtonBatchRoutes(app, boss);

  return app;
}
