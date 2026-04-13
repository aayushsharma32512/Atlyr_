import { supabase } from "@/integrations/supabase/client"

export type WaitlistSubmissionResult = {
  success: boolean
  error?: string
}

async function submitToWaitlist(input: {
  name: string
  email: string
  phone_number: string
  source?: string | null
  metadata?: Record<string, unknown> | null
}): Promise<WaitlistSubmissionResult> {
  const { name, email, phone_number, source, metadata } = input

  const { data, error } = await supabase.rpc("submit_to_waitlist", {
    p_name: name.trim(),
    p_email: email.trim().toLowerCase(),
    p_phone_number: phone_number.trim(),
    p_source: source ?? null,
    p_metadata: metadata ?? {},
  })

  if (error) {
    throw new Error(error.message)
  }

  const payload = (data as WaitlistSubmissionResult | null) ?? null
  if (!payload) {
    return { success: false, error: "UNKNOWN" }
  }

  return payload
}

export const waitlistService = {
  submitToWaitlist,
}
