import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import type PgBoss from 'pg-boss';
import { config } from '../config/index';
import { registerSubmitRoute } from './routes/submit';
import { registerStatusRoutes } from './routes/status';
import { registerProceedRoute } from './routes/proceed';
import { registerRestartRoute } from './routes/restart';
import { registerRetagRoute } from './routes/retag';
import { registerDeletePhotoRoute } from './routes/delete-photo';
import { registerDetailsRoute } from './routes/details';
import { registerSegmentedImageRoute } from './routes/segmented-image';
import { registerPlacementRoute } from './routes/placement';
import { registerPublishRoute } from './routes/publish';
import { registerDeleteRoute } from './routes/delete';

function bearerAuth(req: { headers: Record<string, string | string[] | undefined> }, token: string): boolean {
  const header = req.headers['authorization'] ?? '';
  return header === `Bearer ${token}`;
}

export async function buildApp(boss: PgBoss) {
  // 25 MB: manual placement saves POST a full 1800x3072 PNG as base64, which inflates ~33%.
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });

  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!bearerAuth(req as never, config.API_TOKEN)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  await registerSubmitRoute(app, boss);
  await registerStatusRoutes(app);
  await registerProceedRoute(app, boss);
  await registerRestartRoute(app, boss);
  await registerRetagRoute(app);
  await registerDeletePhotoRoute(app);
  await registerDetailsRoute(app);
  await registerSegmentedImageRoute(app);
  await registerPlacementRoute(app);
  await registerPublishRoute(app);
  await registerDeleteRoute(app);

  return app;
}
