import { supabase } from "@/integrations/supabase/client"

// outfit_candidate_pairs and its RPCs are not in the generated Supabase types
// yet — see the note in candidateThemesService.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedSupabase = supabase as any

export type CandidateDecision = "accepted" | "rejected"

export interface OutfitCandidatePair {
    id: string
    theme_id: string
    pair_rank: number
    top_id: string
    bottom_id: string
    sim_pair: number
    shoes_override_id: string | null
    status: "pending" | "accepted" | "rejected"
    outfit_id: string | null
    decided_by: string | null
    decided_at: string | null
    created_at: string
}

const PAIR_SELECT =
    "id, theme_id, pair_rank, top_id, bottom_id, sim_pair, shoes_override_id, status, outfit_id, decided_by, decided_at, created_at"

/**
 * A theme's review queue. Ordered by sim_pair descending — pair_rank is a
 * rank within one source description, not a global rank across the theme, so
 * it is not a valid ordering here.
 */
export async function fetchPendingPairs(themeId: string): Promise<OutfitCandidatePair[]> {
    const { data, error } = await untypedSupabase
        .from("outfit_candidate_pairs")
        .select(PAIR_SELECT)
        .eq("theme_id", themeId)
        .eq("status", "pending")
        .order("sim_pair", { ascending: false })

    if (error) {
        throw new Error(`Failed to fetch pending pairs: ${error.message}`)
    }

    return (data ?? []) as OutfitCandidatePair[]
}

/**
 * Accept or reject one candidate pair. On accept, the RPC resolves the
 * effective shoe, creates the outfit row, and returns its id; on reject it
 * returns null. All server-side, in one transaction.
 */
export async function decideCandidate(
    candidateId: string,
    decision: CandidateDecision,
): Promise<string | null> {
    const { data, error } = await untypedSupabase.rpc("decide_outfit_candidate", {
        p_candidate_id: candidateId,
        p_decision: decision,
    })

    if (error) {
        throw new Error(`Failed to save decision: ${error.message}`)
    }

    return (data as string | null) ?? null
}

/** Sets (or, passing null, clears) one pending pair's shoe override. */
export async function setPairShoesOverride(
    candidateId: string,
    shoesId: string | null,
): Promise<void> {
    const { error } = await untypedSupabase.rpc("set_pair_shoes_override", {
        p_candidate_id: candidateId,
        p_shoes_id: shoesId,
    })

    if (error) {
        throw new Error(`Failed to set shoe override: ${error.message}`)
    }
}
