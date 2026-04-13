import { useQuery } from "@tanstack/react-query"
import { checkTryOnLimit } from "@/services/tryon/tryonService"
import { checkLikenessLimit } from "@/services/likeness/likenessService"

export type DailyLimits = {
  tryon: { count: number; limit: number; allowed: boolean }
  likeness: { count: number; limit: number; allowed: boolean }
}

/**
 * Fetches daily usage limits for profile page display.
 * Server now reserves slots immediately in DB, so we only query DB counts.
 * (Pending jobs from JobsContext are only used for instant client-side checks
 * in LikenessDrawer before API calls, not for display.)
 */
export function useDailyLimits() {
  return useQuery({
    queryKey: ["daily-limits"],
    queryFn: async (): Promise<DailyLimits> => {
      const [tryon, likeness] = await Promise.all([
        checkTryOnLimit(), // No pendingCount - DB is authoritative now
        checkLikenessLimit(), // No pendingCount - DB is authoritative now
      ])
      return { tryon, likeness }
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
  })
}
