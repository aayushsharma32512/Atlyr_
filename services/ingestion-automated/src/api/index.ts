import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import type PgBoss from 'pg-boss';
import { config } from '../config/index';
import { registerSubmitRoute } from './routes/submit';
import { registerStatusRoutes } from './routes/status';
import { registerProceedRoute } from './routes/proceed';
import { registerRestartRoute } from './routes/restart';
import { registerRetagRoute } from './routes/retag';
import { registerDetailsRoute } from './routes/details';
import { registerSegmentedImageRoute } from './routes/segmented-image';

function bearerAuth(req: { headers: Record<string, string | string[] | undefined> }, token: string): boolean {
  const header = req.headers['authorization'] ?? '';
  return header === `Bearer ${token}`;
}

export async function buildApp(boss: PgBoss) {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 }); // 25MB — base64 PNG edits

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
  await registerDetailsRoute(app);
  await registerSegmentedImageRoute(app);

  return app;
}
