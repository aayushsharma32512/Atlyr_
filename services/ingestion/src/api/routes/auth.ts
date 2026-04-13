import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { config } from '../../config/index';

const BEARER_PREFIX = 'bearer ';

function extractToken(header: unknown): string | null {
  if (!header || typeof header !== 'string') return null;
  const normalized = header.trim();
  if (normalized.length === 0) return null;

  if (normalized.toLowerCase().startsWith(BEARER_PREFIX)) {
    return normalized.slice(BEARER_PREFIX.length).trim();
  }
  return normalized;
}

export type OperatorAuthHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
) => void;

export function createOperatorAuthHook(expectedToken = config.HITL_OPERATOR_TOKEN): OperatorAuthHook {
  return (request, reply, done) => {
    const token = extractToken(request.headers.authorization);
    if (!token || token !== expectedToken) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    done();
  };
}

export function hasOperatorAccess(request: FastifyRequest, expectedToken = config.HITL_OPERATOR_TOKEN): boolean {
  const token = extractToken(request.headers.authorization);
  return Boolean(token && token === expectedToken);
}

