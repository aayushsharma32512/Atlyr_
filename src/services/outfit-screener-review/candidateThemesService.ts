import { supabase } from "@/integrations/supabase/client"

/**
 * outfit_candidate_themes / outfit_candidate_pairs and their RPCs are not in
 * the generated Supabase types yet (the migration that created them ran
 * after the last type regen). Cast the client at each call site, the same
 * way src/services/outfit-enrichment/enrichmentsService.ts does for
 * apply_enriched_to_outfit, until types.ts catches up.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedSupabase = supabase as any

export interface FootwearOption {
    shoes_id: string
    sim_shoes: number
    shoes_line_index: number
    shoes_line: string
}

export interface OutfitCandidateTheme {
    theme_id: string
    theme_name: string
    category_id: string
    footwear_options: FootwearOption[]
    chosen_shoes_id: string
    chosen_by: string | null
    chosen_at: string | null
}

export interface ThemeWithPendingCount extends OutfitCandidateTheme {
    pendingCount: number
}

const THEME_SELECT =
    "theme_id, theme_name, category_id, footwear_options, chosen_shoes_id, chosen_by, chosen_at"

/**
 * All 20 themes, each with a live count of its still-pending candidate pairs.
 * The count is computed client-side from one lightweight query (theme_id only)
 * rather than 20 per-theme count queries or a server-side group-by.
 */
export async function fetchThemesWithPendingCounts(): Promise<ThemeWithPendingCount[]> {
    const [{ data: themes, error: themesError }, { data: pendingRows, error: pendingError }] =
        await Promise.all([
            untypedSupabase
                .from("outfit_candidate_themes")
                .select(THEME_SELECT)
                .order("theme_name", { ascending: true }),
            untypedSupabase.from("outfit_candidate_pairs").select("theme_id").eq("status", "pending"),
        ])

    if (themesError) {
        throw new Error(`Failed to fetch themes: ${themesError.message}`)
    }
    if (pendingError) {
        throw new Error(`Failed to fetch pending counts: ${pendingError.message}`)
    }

    const counts = new Map<string, number>()
    for (const row of (pendingRows ?? []) as { theme_id: string }[]) {
        counts.set(row.theme_id, (counts.get(row.theme_id) ?? 0) + 1)
    }

    return ((themes ?? []) as OutfitCandidateTheme[]).map((theme) => ({
        ...theme,
        pendingCount: counts.get(theme.theme_id) ?? 0,
    }))
}

export async function fetchTheme(themeId: string): Promise<OutfitCandidateTheme | null> {
    const { data, error } = await untypedSupabase
        .from("outfit_candidate_themes")
        .select(THEME_SELECT)
        .eq("theme_id", themeId)
        .maybeSingle()

    if (error) {
        throw new Error(`Failed to fetch theme: ${error.message}`)
    }

    return (data as OutfitCandidateTheme | null) ?? null
}

/** Changes a theme's default shoe. Writes only through the admin-only RPC. */
export async function setThemeShoes(themeId: string, shoesId: string): Promise<void> {
    const { error } = await untypedSupabase.rpc("set_theme_shoes", {
        p_theme_id: themeId,
        p_shoes_id: shoesId,
    })

    if (error) {
        throw new Error(`Failed to set theme shoes: ${error.message}`)
    }
}
