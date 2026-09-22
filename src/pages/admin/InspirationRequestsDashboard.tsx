import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import { AddItemDialog } from "@/components/ingestion-automated/AddItemDialog"
import { useInspirationWebRequests, useMarkInspirationWebRequest } from "@/features/inspiration-import/hooks/useInspirationImport"
import type {
  InspirationImportIntent,
  InspirationWebRequest,
  InspirationWebRequestStatus,
} from "@/services/inspirationImport/types"

type Filter = "pending" | "queued" | "done" | "failed" | "all"
type IntentFilter = InspirationImportIntent | "all"

const FILTERS: Array<{ id: Filter; label: string; statuses: InspirationWebRequestStatus[] | null }> = [
  { id: "pending", label: "pending", statuses: ["selected_for_ingestion"] },
  { id: "queued", label: "in ingestion", statuses: ["queued", "ingesting"] },
  { id: "done", label: "ingested", statuses: ["ingested"] },
  { id: "failed", label: "failed", statuses: ["failed"] },
  { id: "all", label: "all", statuses: null },
]

const INTENT_FILTERS: IntentFilter[] = ["all", "wardrobe", "inspiration"]

const STATUS_LABEL: Record<InspirationWebRequestStatus, string> = {
  selected_for_ingestion: "pending review",
  queued: "queued",
  ingesting: "ingesting",
  ingested: "ingested",
  failed: "failed",
}

const CHIP = "h-7 rounded-control border px-2.5 text-chip font-medium"

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function RequestCard({ request, onSend }: { request: InspirationWebRequest; onSend: (request: InspirationWebRequest) => void }) {
  return (
    <li className="flex gap-3 rounded-control border border-hairline bg-white p-3">
      <div className="flex flex-none gap-1.5">
        <div className="h-24 w-[72px] overflow-hidden rounded-chip border border-hairline bg-background">
          {request.cropUrl ? <img src={request.cropUrl} alt="" className="h-full w-full object-contain" /> : null}
        </div>
        <div className="h-24 w-[72px] overflow-hidden rounded-chip border border-hairline bg-background">
          {request.imageUrl ? <img src={request.imageUrl} alt={request.title} className="h-full w-full object-contain" /> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-card font-medium text-ink">{request.title || "untitled listing"}</p>
          <span
            className={cn(
              CHIP,
              "flex-none",
              request.intent === "wardrobe" ? "border-violet text-violet" : "border-hairline text-taupe",
            )}
          >
            {request.intent}
          </span>
          <span className={cn(CHIP, "flex-none border-hairline text-taupe")}>{STATUS_LABEL[request.status]}</span>
        </div>
        <p className="text-chip text-taupe">
          {request.category ?? "?"} · {request.merchantDomain || "unknown merchant"}
        </p>
        <a
          href={request.listingUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 truncate text-chip text-violet"
        >
          <Icons.openList className="h-3 w-3 flex-none" aria-hidden="true" />
          <span className="truncate">{request.listingUrl}</span>
        </a>
        <p className="text-chip text-taupe">
          {request.userName ?? "unnamed user"} · {formatDate(request.createdAt)}
          {request.ingestionJobId ? ` · job ${request.ingestionJobId.slice(0, 8)}` : ""}
          {request.jobState ? ` · ${request.jobState.replace(/_/g, " ")}` : ""}
          {request.ingestedProductId ? ` · product ${request.ingestedProductId}` : ""}
        </p>
        {request.status === "selected_for_ingestion" ? (
          <button
            type="button"
            onClick={() => onSend(request)}
            className={cn(CHIP, "mt-1 self-start border-ink bg-ink text-white")}
          >
            send to ingestion
          </button>
        ) : null}
      </div>
    </li>
  )
}

export default function InspirationRequestsDashboard() {
  const [filter, setFilter] = useState<Filter>("pending")
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all")
  const [target, setTarget] = useState<InspirationWebRequest | null>(null)
  const requestsQuery = useInspirationWebRequests()
  const markRequest = useMarkInspirationWebRequest()
  const initial = useMemo(() => target ? {
    product_url: target.listingUrl,
    product_type: target.category === "bottom" ? "bottomwear" as const : "topwear" as const,
  } : undefined, [target])
  const linkJob = (jobId: string) => {
    if (target) markRequest.mutate({ selectionId: target.id, ingestionJobId: jobId })
  }
  const requests = requestsQuery.data ?? []
  // The status tabs count within the chosen flow, so the two filters read together.
  const scoped = intentFilter === "all"
    ? requests
    : requests.filter((request) => request.intent === intentFilter)
  const counts = FILTERS.map(({ id, statuses }) => ({
    id,
    count: statuses ? scoped.filter((request) => statuses.includes(request.status)).length : scoped.length,
  }))
  const active = FILTERS.find((item) => item.id === filter) ?? FILTERS[0]
  const visible = active.statuses
    ? scoped.filter((request) => active.statuses?.includes(request.status))
    : scoped

  return (
    <AppShellLayout hideNav>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
        <div className="text-center">
          <h1 className="font-display text-title font-medium text-ink">Inspiration requests</h1>
          <p className="mt-1 text-chip text-taupe">Online listings users asked us to add to inventory.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label="Status">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={cn(CHIP, filter === id ? "border-ink bg-ink text-white" : "border-hairline bg-white text-ink")}
            >
              {label} · {counts.find((item) => item.id === id)?.count ?? 0}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label="Flow">
          {INTENT_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={intentFilter === id}
              onClick={() => setIntentFilter(id)}
              className={cn(CHIP, intentFilter === id ? "border-ink bg-ink text-white" : "border-hairline bg-white text-ink")}
            >
              {id}
            </button>
          ))}
        </div>
        {requestsQuery.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-ink" /></div>
        ) : requestsQuery.isError ? (
          <p className="text-center text-chip text-destructive" role="alert">{requestsQuery.error.message}</p>
        ) : visible.length ? (
          <ul className="flex flex-col gap-2">
            {visible.map((request) => <RequestCard key={request.id} request={request} onSend={setTarget} />)}
          </ul>
        ) : (
          <p className="py-10 text-center text-chip text-taupe">Nothing here yet.</p>
        )}
      </div>
      <AddItemDialog
        open={target !== null}
        onOpenChange={(open) => { if (!open) setTarget(null) }}
        initial={initial}
        onSuccess={linkJob}
        onDuplicate={linkJob}
      />
    </AppShellLayout>
  )
}
