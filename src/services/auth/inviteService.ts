import { supabase } from "@/integrations/supabase/client"

export type InviteCodeType = "beta" | "waitlist_invite" | "special"

export type InviteValidationResult = {
  valid: boolean
  error?: string
  type?: InviteCodeType
  metadata?: Record<string, unknown> | null
}

export type RedeemInviteResult = {
  success: boolean
  error?: string
  already_redeemed?: boolean
}

async function validateInviteCode(code: string): Promise<InviteValidationResult> {
  const trimmed = code.trim()
  if (!trimmed) {
    return { valid: false, error: "INVITE_REQUIRED" }
  }

  const { data, error } = await supabase.rpc("validate_invite_code", { p_code: trimmed })
  if (error) {
    throw new Error(error.message)
  }

  const payload = (data as InviteValidationResult | null) ?? null
  if (!payload) {
    return { valid: false, error: "INVITE_UNKNOWN" }
  }

  return payload
}

async function redeemInvite(code: string): Promise<RedeemInviteResult> {
  const trimmed = code.trim()
  if (!trimmed) {
    return { success: false, error: "INVITE_REQUIRED" }
  }

  const { data, error } = await supabase.rpc("redeem_invite", { p_code: trimmed })
  if (error) {
    throw new Error(error.message)
  }

  const payload = (data as RedeemInviteResult | null) ?? null
  if (!payload) {
    return { success: false, error: "INVITE_UNKNOWN" }
  }

  return payload
}

async function hasAppAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_app_access")
  if (error) {
    throw new Error(error.message)
  }
  return Boolean(data)
}

export const inviteService = {
  hasAppAccess,
  redeemInvite,
  validateInviteCode,
}

