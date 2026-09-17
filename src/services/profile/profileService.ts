import { supabase } from "@/integrations/supabase/client"
import type { Tables, TablesUpdate } from "@/integrations/supabase/types"
import { profilePhotoToWebp } from "@/features/profile/utils/profilePhotoToWebp"

export type ProfileRecord = Tables<"profiles">
export type ProfileUpdateInput = TablesUpdate<"profiles">

const PROFILE_PHOTO_BUCKET = "public-files"
const PROFILE_PHOTO_MAX_BYTES = 20 * 1024 * 1024

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

/** The photo URL lives in auth user metadata, the same `avatar_url` key Google sign-in fills. */
async function uploadProfilePhoto(userId: string, file: File): Promise<string> {
  if (!userId) {
    throw new Error("Cannot upload a photo without a user id")
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file")
  }
  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error("Choose an image under 20 MB")
  }

  const photo = await profilePhotoToWebp(file)
  const filePath = `profile-photos/${userId}/${Date.now()}.webp`

  const { error: uploadError } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(filePath, photo, { contentType: photo.type, cacheControl: "31536000" })

  if (uploadError) {
    throw new Error(uploadError.message)
  }

  const { data } = supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(filePath)
  const { error: metadataError } = await supabase.auth.updateUser({
    data: { avatar_url: data.publicUrl },
  })

  if (metadataError) {
    throw new Error(metadataError.message)
  }

  return data.publicUrl
}

export const profileService = {
  getProfile,
  updateProfile,
  uploadProfilePhoto,
}
