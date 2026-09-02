import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, RotateCcw, ScanSearch, Shirt, Sparkles } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { CandidatePicker } from "@/features/inspiration-import/components/CandidatePicker"
import { CatalogueMatchRack } from "@/features/inspiration-import/components/CatalogueMatchRack"
import { ImportMannequinPreview } from "@/features/inspiration-import/components/ImportMannequinPreview"
import { InspirationSourceInput } from "@/features/inspiration-import/components/InspirationSourceInput"
import { WebMatchRack } from "@/features/inspiration-import/components/WebMatchRack"
import {
  useCommitImportSelections,
  useDetectImportCandidates,
  useImportCatalogueResults,
  useImportWebResults,
  useInspirationImport,
  useSelectImportCandidates,
  useStartInspirationImport,
} from "@/features/inspiration-import/hooks/useInspirationImport"
import type {
  InspirationCatalogueResult,
  InspirationCategory,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

function BottomGarmentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current stroke-[1.8]">
      <path d="M8 3h8l1.5 18h-5L12 12l-.5 9h-5L8 3Z" strokeLinejoin="round" />
    </svg>
  )
}

export default function InspirationImportScreen() {
  const { importId: routeImportId } = useParams<{ importId?: string }>()
  const importId = routeImportId ?? null
  const navigate = useNavigate()
  const startImport = useStartInspirationImport()
  const importQuery = useInspirationImport(importId)
  const detectMutation = useDetectImportCandidates(importId ?? "")
  const selectMutation = useSelectImportCandidates(importId ?? "")
  const webMutation = useImportWebResults(importId ?? "")
  const commitMutation = useCommitImportSelections(importId ?? "")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [pendingCandidateIds, setPendingCandidateIds] = useState<string[]>([])
  const [previewIds, setPreviewIds] = useState<Partial<Record<InspirationCategory, string>>>({})
  const [catalogueIds, setCatalogueIds] = useState<Set<string>>(new Set())
  const [webResultId, setWebResultId] = useState<string | null>(null)
  const [choosingCandidate, setChoosingCandidate] = useState(false)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)
  const [resultsSource, setResultsSource] = useState<"inventory" | "web">("inventory")
  const [loadedSelectionKey, setLoadedSelectionKey] = useState("")

  const record = importQuery.data
  const selectedCandidates = useMemo(() => {
    if (!record) return []
    const selectedIds = new Set(record.selectedCandidateIds)
    return record.candidates.filter((candidate) => selectedIds.has(candidate.id))
  }, [record])
  const selectedCandidate = selectedCandidates.find((item) => item.id === activeCandidateId)
    ?? selectedCandidates[0]
    ?? null
  const catalogueSearches = useImportCatalogueResults(record)
  const activeCatalogueSearch = catalogueSearches.find(({ candidate }) => candidate.id === selectedCandidate?.id)
  const catalogueResults = activeCatalogueSearch?.results ?? []
  const availableWebResults = useMemo(() => {
    const resultsById = new Map<string, InspirationWebResult>()
    for (const result of record?.webResults ?? []) resultsById.set(result.id, result)
    for (const result of webMutation.data ?? []) resultsById.set(result.id, result)
    return [...resultsById.values()]
  }, [record?.webResults, webMutation.data])
  const webResults = availableWebResults
    .filter((result) => result.candidateId === selectedCandidate?.id)
  const selectedWebResult = availableWebResults.find((result) => result.id === webResultId) ?? null
  const activePreviewId = selectedCandidate
    ? previewIds[selectedCandidate.category] ?? catalogueResults[0]?.id ?? null
    : null
  const mannequinResults = useMemo(() => selectedCandidates.reduce<Partial<Record<InspirationCategory, InspirationCatalogueResult | null>>>((results, candidate) => {
    const search = catalogueSearches.find((item) => item.candidate.id === candidate.id)
    const previewId = previewIds[candidate.category]
    results[candidate.category] = search?.results.find((item) => item.id === previewId)
      ?? search?.results[0]
      ?? null
    return results
  }, {}), [catalogueSearches, previewIds, selectedCandidates])
  const selectionKey = record
    ? `${record.import.id}:${record.selectedCandidateIds.join(",")}:${record.selections.catalogueProductIds.join(",")}:${record.selections.webResultId ?? ""}`
    : ""

  useEffect(() => {
    if (!record) return
    setPendingCandidateIds((current) => {
      if (record.selectedCandidateIds.length) {
        const selectionUnchanged = record.selectedCandidateIds.length === current.length
          && record.selectedCandidateIds.every((id, index) => id === current[index])
        return selectionUnchanged ? current : record.selectedCandidateIds
      }

      const candidateIds = new Set(record.candidates.map((candidate) => candidate.id))
      const validCurrent = current.filter((id) => candidateIds.has(id))
      if (validCurrent.length) return validCurrent.length === current.length ? current : validCurrent

      const defaultCandidate = record.candidates.reduce((best, candidate) => (
        !best || candidate.confidence > best.confidence ? candidate : best
      ), record.candidates[0])
      return defaultCandidate ? [defaultCandidate.id] : current
    })
  }, [record])

  useEffect(() => {
    if (!record || selectionKey === loadedSelectionKey) return
    setLoadedSelectionKey(selectionKey)
    setActiveCandidateId((current) => record.selectedCandidateIds.includes(current ?? "")
      ? current
      : record.selectedCandidateIds[0] ?? null)
    setPreviewIds({})
    setCatalogueIds(new Set(record.selections.catalogueProductIds))
    setWebResultId(record.selections.webResultId)
    setResultsSource(record.selections.webResultId ? "web" : "inventory")
  }, [loadedSelectionKey, record, selectionKey])

  const selectedTotal = catalogueIds.size + (webResultId ? 1 : 0)
  const isCommitted = commitMutation.isSuccess || record?.import.status === "committed"
  const primaryError = validationError
    ?? startImport.error?.message
    ?? importQuery.error?.message
    ?? selectMutation.error?.message
    ?? catalogueSearches.find(({ error }) => error)?.error?.message
    ?? webMutation.error?.message
    ?? commitMutation.error?.message
    ?? record?.import.errorMessage
    ?? null

  const categorizedCount = useMemo(() => {
    if (!record) return { top: 0, bottom: 0 }
    return record.candidates.reduce((counts, candidate) => ({
      ...counts,
      [candidate.category]: counts[candidate.category] + 1,
    }), { top: 0, bottom: 0 })
  }, [record])

  const onFile = (file: File) => {
    setValidationError(null)
    if (!ACCEPTED_TYPES.has(file.type)) {
      setSourceFile(null)
      setValidationError("Choose a JPEG, PNG or WebP image.")
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setSourceFile(null)
      setValidationError("Choose an image smaller than 10 MB.")
      return
    }
    setSourceFile(file)
  }

  const submitSource = () => {
    if (!sourceFile) return
    startImport.mutate(sourceFile, {
      onSuccess: ({ importId: nextId }) => navigate(`/inspiration-import/${nextId}`, { replace: true }),
    })
  }

  const toggleCandidate = (candidateId: string) => {
    const candidate = record?.candidates.find((item) => item.id === candidateId)
    if (!candidate) return
    setPendingCandidateIds((current) => {
      if (current.includes(candidateId)) return current.filter((id) => id !== candidateId)
      const withoutCategory = current.filter((id) => {
        const selected = record.candidates.find((item) => item.id === id)
        return selected?.category !== candidate.category
      })
      return [...withoutCategory, candidateId]
    })
  }

  const toggleCatalogue = (productId: string) => {
    setCatalogueIds((current) => {
      const next = new Set(current)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const showWebResults = () => {
    if (!selectedCandidate) return
    if (webResults.length) {
      setResultsSource("web")
      return
    }
    webMutation.mutate(selectedCandidate.id, {
      onSuccess: () => setResultsSource("web"),
    })
  }

  if (!importId) {
    return (
      <main className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="flex h-16 items-center justify-center px-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Import inspiration
          </span>
        </header>
        <InspirationSourceInput
          file={sourceFile}
          isPending={startImport.isPending}
          error={primaryError}
          onFile={onFile}
          onSubmit={submitSource}
        />
      </main>
    )
  }

  if (importQuery.isLoading || !record) {
    if (importQuery.isError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-5">
          <section className="max-w-md rounded-frame border border-destructive/30 bg-card p-7 text-center" role="alert">
            <h1 className="font-display text-3xl font-medium">This import couldn’t be opened.</h1>
            <p className="mt-3 text-sm text-muted-foreground">{importQuery.error.message}</p>
            <Button className="mt-6" onClick={() => navigate("/inspiration-import")}>Start a new import</Button>
          </section>
        </main>
      )
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-terracotta" />
          <p className="mt-3 text-xs text-muted-foreground">Opening inspiration…</p>
        </div>
      </main>
    )
  }

  if (isCommitted) {
    return (
      <main className="min-h-screen bg-background px-5 py-10 text-foreground">
        <section className="mx-auto max-w-lg rounded-frame border border-hairline bg-card p-7 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-gold text-gold">
            <Sparkles className="size-6" />
          </span>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">Look captured</p>
          <h1 className="mt-2 font-display text-4xl font-medium">Your pieces are saved.</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            Catalogue items are in Wardrobe. Any online selection is marked ready for a later import; ingestion has not started.
          </p>
          <div className="mt-7 space-y-2 border-y border-hairline py-5 text-left text-sm">
            <div className="flex justify-between"><span>Catalogue items</span><span>{record.selections.catalogueProductIds.length || catalogueIds.size}</span></div>
            <div className="flex justify-between"><span>Online item</span><span>{record.selections.webResultId || webResultId ? "Ready to import" : "None"}</span></div>
          </div>
          <Button className="mt-7 w-full bg-terracotta text-white hover:bg-terracotta/90" onClick={() => navigate("/inspiration-import")}>Import another look</Button>
        </section>
      </main>
    )
  }

  if (record.import.status === "detecting" || record.import.status === "source_ready") {
    return (
      <main className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
        <header className="relative flex h-14 shrink-0 items-center justify-center px-4 sm:h-16">
          <button
            type="button"
            aria-label="Back to import"
            className="absolute left-4 flex size-10 items-center justify-center"
            onClick={() => navigate("/inspiration-import")}
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Select pieces
          </span>
        </header>
        <section className="mx-auto min-h-0 w-full max-w-2xl flex-1 px-3 pb-3 pt-1 sm:px-5">
          <p className="mb-3 shrink-0 text-center text-xs font-semibold text-muted-foreground sm:mb-7">
            Looking for outfits…
          </p>
          <div
            className="relative mx-auto w-fit max-w-full overflow-hidden rounded-[8px] border border-hairline bg-card sm:w-full"
            aria-busy="true"
          >
            {record.sourceUrl ? (
              <img
                src={record.sourceUrl}
                alt="Uploaded inspiration"
                className="block max-h-[calc(100dvh-21rem)] w-auto max-w-full sm:max-h-none sm:w-full"
              />
            ) : null}
            <div className="pointer-events-none absolute inset-0 bg-foreground/5">
              <span
                aria-hidden="true"
                className="inspiration-scan-line absolute inset-x-0 z-10 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent"
              />
              <span className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-terracotta">
                <Loader2 className="size-3.5 animate-spin" /> Identifying pieces
              </span>
            </div>
          </div>
        </section>
      </main>
    )
  }

  const isChoosingCandidate = !selectedCandidate || choosingCandidate

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <header className="z-30 flex h-14 shrink-0 items-center justify-between bg-background/95 px-4 backdrop-blur sm:h-16">
        <button
          type="button"
          aria-label="Back"
          className="flex size-10 items-center justify-center"
          onClick={() => {
            if (isChoosingCandidate && selectedCandidate) setChoosingCandidate(false)
            else navigate("/inspiration-import")
          }}
        >
          <ArrowLeft className="size-4" />
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {isChoosingCandidate ? "Select pieces" : "Your import"}
        </span>
        <span className="w-10 text-right text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {isChoosingCandidate ? "" : null}
        </span>
      </header>

      <div className={`mx-auto min-h-0 w-full flex-1 overflow-y-auto px-4 sm:px-5 ${isChoosingCandidate ? "max-w-2xl py-0 sm:py-1" : "max-w-5xl py-2 sm:py-7"}`}>
        {isChoosingCandidate ? (
          <section>
            <p className="mb-3 text-center text-xs font-semibold leading-5 text-muted-foreground sm:mb-7">
              {categorizedCount.top + categorizedCount.bottom} pieces found — pick one top and one bottom
            </p>
            {record.sourceUrl ? (
              <CandidatePicker
                sourceUrl={record.sourceUrl}
                candidates={record.candidates}
                selectedIds={pendingCandidateIds}
                onSelect={toggleCandidate}
              />
            ) : null}
          </section>
        ) : (
          <section>
            <div className="grid h-[clamp(14rem,40dvh,22rem)] grid-cols-2 gap-3 sm:h-auto sm:aspect-[3/2]">
              <div className="relative overflow-hidden rounded-[7px] border border-hairline bg-card">
                {record.sourceUrl ? <img src={record.sourceUrl} alt="Uploaded inspiration reference" className="h-full w-full object-cover" /> : null}
                <span className="absolute left-3 top-3 rounded-[3px] bg-foreground px-2 py-1 text-[8px] font-bold uppercase tracking-[0.12em] text-background">
                  Ref
                </span>
              </div>
              <ImportMannequinPreview
                results={mannequinResults}
                webResult={resultsSource === "web" ? selectedWebResult : null}
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-4 sm:mt-3">
              <div className="flex gap-2" aria-label="Piece to match">
                {(["top", "bottom"] as const).map((category) => {
                  const candidate = selectedCandidates.find((item) => item.category === category)
                  const active = candidate?.id === selectedCandidate.id
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-label={`Show ${category} matches`}
                      aria-pressed={active}
                      disabled={!candidate}
                      onClick={() => {
                        if (!candidate) return
                        setActiveCandidateId(candidate.id)
                        setResultsSource("inventory")
                      }}
                      className={`flex size-11 items-center justify-center rounded-[6px] border transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-hairline bg-card text-muted-foreground disabled:bg-muted disabled:text-muted-foreground/30"}`}
                    >
                      {category === "top" ? <Shirt className="size-4" /> : <BottomGarmentIcon />}
                    </button>
                  )
                })}
              </div>
              {resultsSource === "web" ? (
                <button
                  type="button"
                  className="flex h-9 items-center gap-1 rounded-[5px] border border-hairline bg-card px-3 text-[9px] font-semibold uppercase tracking-[0.13em] text-foreground"
                  onClick={() => setResultsSource("inventory")}
                >
                  <ChevronLeft className="size-3" /> Inventory
                </button>
              ) : (
                <button
                  type="button"
                  className="flex h-9 items-center gap-1 rounded-[5px] border border-hairline bg-card px-3 text-[9px] font-semibold uppercase tracking-[0.13em] text-foreground disabled:cursor-wait disabled:text-muted-foreground"
                  onClick={showWebResults}
                  disabled={webMutation.isPending}
                >
                  {webMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
                  {webMutation.isPending ? "Searching" : "Web search"}
                  {webMutation.isPending ? null : <ChevronRight className="size-3" />}
                </button>
              )}
            </div>

            <div className="mt-2 min-w-0 sm:mt-4">
              {resultsSource === "web" ? (
                webResults.length ? (
                  <WebMatchRack results={webResults} selectedId={webResultId} onSelect={setWebResultId} />
                ) : (
                  <div className="flex min-h-52 items-center justify-center rounded-[7px] border border-hairline bg-card px-6 text-center text-xs text-muted-foreground">
                    No online matches found for this piece.
                  </div>
                )
              ) : activeCatalogueSearch?.isLoading ? (
                <div className="flex min-h-52 items-center justify-center rounded-[7px] border border-hairline bg-card">
                  <Loader2 className="size-5 animate-spin text-terracotta" />
                </div>
              ) : (
                <CatalogueMatchRack
                  results={catalogueResults}
                  previewId={activePreviewId}
                  selectedIds={catalogueIds}
                  onPreview={(id) => setPreviewIds((current) => ({ ...current, [selectedCandidate.category]: id }))}
                  onToggle={toggleCatalogue}
                />
              )}
            </div>

            <button type="button" className="mt-5 text-[10px] font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setChoosingCandidate(true)}>
              Change selected pieces
            </button>
          </section>
        )}

        {primaryError ? (
          <div className="mt-6 rounded-frame border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
            {primaryError}
            {record.import.status === "failed" ? (
              <Button variant="outline" size="sm" className="ml-3" onClick={() => detectMutation.mutate()} disabled={detectMutation.isPending}>
                <RotateCcw className="size-3" /> Retry
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="z-40 shrink-0 border-t border-hairline bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:p-4">
        <div className={`mx-auto ${isChoosingCandidate ? "max-w-2xl" : "max-w-5xl"}`}>
          {isChoosingCandidate ? (
            <Button
              className="h-12 w-full rounded-[4px] bg-terracotta text-sm font-semibold text-white hover:bg-terracotta/90 sm:h-14 sm:text-base"
              disabled={!pendingCandidateIds.length || selectMutation.isPending}
              onClick={() => pendingCandidateIds.length && selectMutation.mutate(pendingCandidateIds, {
                onSuccess: () => setChoosingCandidate(false),
              })}
            >
              {selectMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
              Find matches · {pendingCandidateIds.length} piece{pendingCandidateIds.length === 1 ? "" : "s"}
            </Button>
          ) : (
            <Button
              className="h-12 w-full rounded-[4px] bg-terracotta text-sm font-semibold text-white hover:bg-terracotta/90 sm:h-14 sm:text-base"
              disabled={!selectedTotal || commitMutation.isPending}
              onClick={() => commitMutation.mutate({ catalogueProductIds: [...catalogueIds], webResultId })}
            >
              {commitMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {selectedTotal ? "Proceed" : "Select pieces to continue"}
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
