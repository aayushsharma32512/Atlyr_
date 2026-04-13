// @ts-nocheck
/* eslint-disable */
import type { AuthContext } from "./auth.ts"

export type ProfileMetadata = {
  height_cm?: number | null
  weight_kg?: number | null
  skin_tone?: string | null
}

export async function fetchUserProfile(ctx: AuthContext): Promise<ProfileMetadata> {
  if (!ctx?.adminClient || !ctx?.userId) {
    return {}
  }
  try {
    const { data, error } = await ctx.adminClient
      .from("profiles")
      .select("height_cm, weight_kg, skin_tone")
      .eq("id", ctx.userId)
      .maybeSingle()
    if (error || !data) {
      return {}
    }
    return {
      height_cm: data.height_cm ?? null,
      weight_kg: data.weight_kg ?? null,
      skin_tone: data.skin_tone ?? null,
    }
  } catch (_err) {
    return {}
  }
}


