import { supabase } from "@/integrations/supabase/client"

export type AvatarHairGender = "male" | "female"

export type AvatarHairStyleRecord = {
  id: string
  gender: AvatarHairGender
  styleKey: string
  assetUrl: string
  lengthPct: number
  yOffsetPct: number
  xOffsetPct: number
  zIndex: number
  isDefault: boolean
  sortOrder: number
  isActive: boolean
}

type DbAvatarHairStyleRow = {
  id: string
  gender: "male" | "female"
  style_key: string
  asset_url: string
  length_pct: number
  y_offset_pct: number
  x_offset_pct: number
  z_index: number
  is_default: boolean
  is_active: boolean
  sort_order: number
}

function mapRow(row: DbAvatarHairStyleRow): AvatarHairStyleRecord {
  return {
    id: row.id,
    gender: row.gender,
    styleKey: row.style_key,
    assetUrl: row.asset_url,
    lengthPct: Number(row.length_pct),
    yOffsetPct: Number(row.y_offset_pct),
    xOffsetPct: Number(row.x_offset_pct ?? 0),
    zIndex: Number(row.z_index),
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
  }
}

export async function fetchAvatarHairStylesByGender(gender: AvatarHairGender): Promise<AvatarHairStyleRecord[]> {
  const { data, error } = await supabase
    .from("avatar_hair_styles")
    .select("id,gender,style_key,asset_url,length_pct,y_offset_pct,x_offset_pct,z_index,is_default,is_active,sort_order")
    .eq("gender", gender)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => mapRow(row as DbAvatarHairStyleRow))
}

export const avatarHairStylesService = {
  fetchAvatarHairStylesByGender,
}
