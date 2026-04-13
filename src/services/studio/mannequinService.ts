import { supabase } from "@/integrations/supabase/client"
import type { MannequinConfig, MannequinSegmentConfig, MannequinSegmentName } from "@/features/studio/types"
import { MANNEQUIN_SEGMENT_NAMES } from "@/features/studio/constants"

interface DbMannequinRow {
  id: string
  gender: "male" | "female"
  body_type: string
  height_cm: number | null
  default_scale: number | null
  segment_config: Record<string, unknown> | null
  is_default: boolean | null
  created_at: string | null
  updated_at: string | null
}

function mapSegmentRecord(record: Record<string, unknown> | null | undefined): Record<MannequinSegmentName, MannequinSegmentConfig> {
  const toNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
    if (typeof value === "string") {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
    return undefined
  }

  const segments = {} as Record<MannequinSegmentName, MannequinSegmentConfig>

  MANNEQUIN_SEGMENT_NAMES.forEach((segmentName) => {
    const entry = (record?.[segmentName] as Record<string, unknown> | undefined) ?? {}
    const assetUrl = typeof entry.asset_url === "string" ? entry.asset_url : ""
    const lengthPct = toNumber(entry.length_pct) ?? 0
    const placementYPct = toNumber(entry.placement_y_pct) ?? 0
    const zIndex = toNumber(entry.z_index) ?? 0
    const xOffsetPct = toNumber(entry.x_offset_pct)

    segments[segmentName] = {
      name: segmentName,
      assetUrl,
      lengthPct,
      placementYPct,
      zIndex,
      xOffsetPct,
    }
  })

  return segments
}

function mapRowToConfig(row: DbMannequinRow): MannequinConfig {
  return {
    id: row.id,
    gender: row.gender as "male" | "female",
    bodyType: row.body_type,
    heightCm: Number(row.height_cm ?? 0),
    defaultScale: Number(row.default_scale ?? 1),
    segments: mapSegmentRecord(row.segment_config as Record<string, unknown> | undefined),
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  }
}

export interface FetchMannequinConfigInput {
  gender: "male" | "female"
  bodyType?: string
}

export async function fetchMannequinConfig({
  gender,
  bodyType,
}: FetchMannequinConfigInput): Promise<MannequinConfig | null> {
  // Supabase generates very deep conditional types for JSON-heavy selects.
  // Casting the builder to `any` keeps the runtime behavior while avoiding the
  // "type instantiation is excessively deep" compiler error.
  const client = supabase as any

  let query = client
    .from("mannequin")
    .select("id, gender, body_type, height_cm, default_scale, segment_config, is_default, created_at, updated_at")
    .eq("gender", gender)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)

  if (bodyType) {
    query = query.eq("body_type", bodyType)
  }

  const { data, error } = (await query.maybeSingle()) as {
    data: DbMannequinRow | null
    error: { message: string } | null
  }

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    return null
  }

  return mapRowToConfig(data)
}

export const mannequinService = {
  fetchMannequinConfig,
}

