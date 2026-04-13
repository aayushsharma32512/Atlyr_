import { supabase } from '@/integrations/supabase/client'

export async function getOrSignInAnon(): Promise<{ userId: string | null }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) {
      console.info('[Auth] Existing session found', { userId: session.user.id })
      return { userId: session.user.id }
    }

    // Anonymous sign-in is disabled. 
    // If no existing session, return null. The user must log in manually.
    return { userId: null }
  } catch (e) {
    console.error('[Auth] getOrSignInAnon exception', { message: (e as Error).message })
    return { userId: null }
  }
}


