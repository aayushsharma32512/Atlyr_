import { useMemo, useState } from "react"

import { Icons } from "@/design-system/icons"
import { useMyWardrobeWebRequests } from "@/features/wardrobe-import/hooks/useMyWardrobeWebRequests"
import { cn } from "@/lib/utils"
import type { InspirationMyWebRequest } from "@/services/inspirationImport/types"

const STATUS_LABEL: Record<string, string> = {
  selected_for_ingestion: "in review",
  queued: "being added",
  ingesting: "being added",
  failed: "not added",
}

function RequestRow({ request }: { request: InspirationMyWebRequest }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="h-12 w-11 flex-none overflow-hidden rounded-chip bg-editorial">
        {request.imageUrl ? (
          <img src={request.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-card font-medium text-ink">{request.title || "Online pick"}</p>
        <p className="truncate text-chip text-taupe">{request.merchantDomain}</p>
      </div>
      <span
        className={cn(
          "flex-none text-chip",
          request.status === "failed" ? "text-destructive" : "text-taupe",
        )}
      >
        {STATUS_LABEL[request.status] ?? "in review"}
      </span>
    </li>
  )
}

/**
 * An online pick reaches the wardrobe only once the team approves it, so the
 * board needs somewhere to say the request is alive. Renders on the wardrobe
 * board only, and only while something is still on its way.
 */
export function WardrobePendingStrip({ slug }: { slug: string | null }) {
  const isWardrobe = slug === "wardrobe"
  const requests = useMyWardrobeWebRequests()
  const [expanded, setExpanded] = useState(false)

  const { pending, listed } = useMemo(() => {
    const all = requests.data ?? []
    return {
      pending: all.filter((request) => request.status !== "ingested" && request.status !== "failed"),
      listed: all.filter((request) => request.status !== "ingested"),
    }
  }, [requests.data])

  if (!isWardrobe || pending.length === 0) return null

  return (
    <section className="mb-3 rounded-control border border-hairline bg-white px-3">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 py-2.5 text-left"
      >
        <Icons.sourceWardrobe className="h-4 w-4 flex-none text-violet" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-card font-medium text-ink">
          {pending.length} {pending.length === 1 ? "item" : "items"} on their way
        </span>
        <Icons.disclose
          className={cn("h-4 w-4 flex-none text-taupe transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {listed.map((request) => (
            <RequestRow key={request.selectionId} request={request} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
