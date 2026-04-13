// @ts-nocheck
/* eslint-disable */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type AuthContext = {
  supabaseUrl: string
  supabaseServiceKey: string
  // Client with user Authorization header (for auth.getUser only)
  authClient: ReturnType<typeof createClient>
  // Admin client without user Authorization header (bypasses RLS via service role)
  adminClient: ReturnType<typeof createClient>
  userId: string | null
  correlationId: string
}

export function getCorrelationId(req: Request): string {
  const header = req.headers.get('x-correlation-id')
  return header && header.trim().length > 0 ? header.trim() : crypto.randomUUID()
}

export async function requireUser(req: Request): Promise<AuthContext> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  // Auth client carries the incoming Authorization to resolve user
  const authClient = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  // Admin client uses only the service role (no Authorization header)
  const adminClient = createClient(supabaseUrl, supabaseServiceKey)

  const correlationId = getCorrelationId(req)

  try {
    const { data: { user }, error } = await authClient.auth.getUser()
    if (error) {
      console.warn('[Auth][requireUser] getUser error', { correlationId, error: error.message })
    }
    const userId = user?.id ?? null
    return { supabaseUrl, supabaseServiceKey, authClient, adminClient, userId, correlationId }
  } catch (e) {
    console.error('[Auth][requireUser] unexpected error', { correlationId, error: (e as Error).message })
    return { supabaseUrl, supabaseServiceKey, authClient, adminClient, userId: null, correlationId }
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
}

