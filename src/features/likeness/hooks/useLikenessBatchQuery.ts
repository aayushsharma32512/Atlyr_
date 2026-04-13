import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"

export type LikenessCandidateFromDB = {
  id: string
  candidateIndex: number
  storagePath: string
  mimeType: string
  signedUrl: string | null
  identitySummary: string | null
}

async function fetchLikenessBatch(batchId: string): Promise<LikenessCandidateFromDB[]> {
  const { data, error } = await supabase.functions.invoke("likeness-get-batch", {
    body: { batchId },
  })

  if (error) {
    throw new Error(error.message)
  }

  if (data?.status !== "ok") {
    throw new Error("Batch not found")
  }

  return (data.candidates ?? []).map((c: any) => ({
    id: c.candidateId,
    candidateIndex: c.index,
    storagePath: c.path,
    mimeType: c.mimeType,
    signedUrl: c.signedUrl,
    identitySummary: c.summary,
  }))
}

export function useLikenessBatchQuery(batchId: string | null) {
  return useQuery({
    queryKey: ["likeness-batch", batchId],
    queryFn: () => (batchId ? fetchLikenessBatch(batchId) : Promise.resolve([])),
    enabled: Boolean(batchId),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: (query) => {
      // Keep refetching every 5s if no data yet
      return query.state.data && query.state.data.length > 0 ? false : 5000
    },
  })
}
