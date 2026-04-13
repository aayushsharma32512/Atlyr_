import { useMemo } from "react"

import { useMannequinConfig } from "@/features/studio/hooks/useMannequinConfig"
import { useOutfitProducts } from "@/features/studio/hooks/useOutfitProducts"

interface MannequinDataProbeProps {
  outfitId: string | null
  gender?: "male" | "female" | null
  bodyType?: string | null
}

export function MannequinDataProbe({ outfitId, gender = "female", bodyType }: MannequinDataProbeProps) {
  const mannequinQuery = useMannequinConfig({ gender, bodyType })
  const outfitQuery = useOutfitProducts({ outfitId })

  const payload = useMemo(
    () => ({
      mannequin: mannequinQuery.data,
      products: outfitQuery.data,
      bodyPartsVisibleByZone: outfitQuery.bodyPartsVisibleByZone,
    }),
    [mannequinQuery.data, outfitQuery.data, outfitQuery.bodyPartsVisibleByZone],
  )

  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card/40 p-3 text-[10px] leading-relaxed">
      <p className="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">Mannequin data probe</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-muted-foreground">
        {JSON.stringify(payload, null, 2)}
      </pre>
      {(mannequinQuery.isLoading || outfitQuery.isLoading) && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
      {(mannequinQuery.isError || outfitQuery.isError) && <p className="mt-2 text-xs text-destructive">Failed to load data.</p>}
    </div>
  )
}

