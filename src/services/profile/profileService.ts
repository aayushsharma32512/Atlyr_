import { supabase } from "@/integrations/supabase/client"
import type { Tables, TablesUpdate } from "@/integrations/supabase/types"

export type ProfileRecord = Tables<"profiles">
export type ProfileUpdateInput = TablesUpdate<"profiles">

async function getProfile(userId: string): Promise<ProfileRecord | null> {
  if (!userId) {
    throw new Error("Cannot load profile without a user id")
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

async function updateProfile(userId: string, updates: ProfileUpdateInput): Promise<ProfileRecord> {
  if (!userId) {
    throw new Error("Cannot update profile without a user id")
  }

  const { data: updatedProfile, error: updateError } = await supabase
    .from("profiles")
    .update(updates)
    .eq("user_id", userId)
    .select()
    .maybeSingle()

  if (updateError) {
    throw new Error(updateError.message)
  }

  if (updatedProfile) {
    return updatedProfile
  }

  const nameFromUpdates = (updates as Partial<ProfileRecord>).name
  const { data: insertedProfile, error: insertError } = await supabase
    .from("profiles")
    .insert({
      user_id: userId,
      name: typeof nameFromUpdates === "string" && nameFromUpdates.trim().length > 0 ? nameFromUpdates : "User",
      ...updates,
    })
    .select()
    .single()

  if (insertError) {
    throw new Error(insertError.message)
  }

  return insertedProfile
}

export const profileService = {
  getProfile,
  updateProfile,
}
