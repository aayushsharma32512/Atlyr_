// Config-wired singleton router — the one place route configuration, transport, governor and
// breaker meet. Adapters call `geminiRouter().call(...)`; tests use createRouter with fakes.

import { config } from '../../config/index';
import { governor } from '../../utils/governor';
import { routeBreaker } from '../../utils/circuit-breaker';
import { parseRoutes } from './route-spec';
import { createRouter, type GeminiCallResult, type GeminiRequest, type GeminiPart, type RouteAttempt } from './router';
import { geminiTransport } from './gemini-transport';
import { createLogger } from '../../utils/logger';

export type { GeminiCallResult, GeminiRequest, GeminiPart, RouteAttempt };

const logger = createLogger({ stage: 'llm:router' });

let _router: ReturnType<typeof createRouter> | undefined;

export function geminiRouter() {
  if (!_router) {
    const routes = parseRoutes(config.GEMINI_ROUTES);
    // Budgeted per route+model pool (the router's key), so the ceiling is set as the default for
    // keys as they appear rather than enumerated here — the model list comes from the request.
    governor.setDefaultLimit(config.GEMINI_ROUTE_MAX_CONCURRENT);
    logger.info({ routes: routes.map((r) => r.id), maxConcurrent: config.GEMINI_ROUTE_MAX_CONCURRENT }, 'gemini routes configured');

    _router = createRouter({
      routes,
      transport: geminiTransport,
      governor,
      breaker: routeBreaker,
      onEvent: (e) => {
        if (e.type === 'rate_limited' || e.type === 'route_skipped_open_breaker' || e.type === 'waiting_for_capacity') {
          logger.warn(e, 'gemini route event');
        } else {
          logger.info(e, 'gemini route event');
        }
      },
    });
  }
  return _router;
}
