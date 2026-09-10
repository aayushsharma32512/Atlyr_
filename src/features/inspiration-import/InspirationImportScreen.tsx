import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, RotateCcw, ScanSearch, Shirt, Sparkles } from "lucide-react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/contexts/AuthContext"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { CandidatePicker } from "@/features/inspiration-import/components/CandidatePicker"
import { CatalogueMatchRack } from "@/features/inspiration-import/components/CatalogueMatchRack"
import {
  ImportMannequinPreview,
} from "@/features/inspiration-import/components/ImportMannequinPreview"
import { InspirationSourceInput } from "@/features/inspiration-import/components/InspirationSourceInput"
import { WebMatchRack } from "@/features/inspiration-import/components/WebMatchRack"
import { getDefaultCandidateIds } from "@/features/inspiration-import/candidateSelection"
import {
  toggleInventoryChoice,
  toggleWebChoice,
  type InspirationResultChoice,
} from "@/features/inspiration-import/selectionTransitions"
import {
  useDetectImportCandidates,
  useImportCatalogueResults,
  useImportWebResults,
  useInspirationImport,
  useOpenInspirationImportInStudio,
  useSelectImportCandidates,
  useStageImportSelections,
  useStartInspirationImport,
} from "@/features/inspiration-import/hooks/useInspirationImport"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { buildStudioUrl } from "@/features/studio/utils/studioUrlState"
import type {
  InspirationCatalogueResult,
  InspirationCategory,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const PROCESSING_IMPORT_ID = "processing"

type CategoryChoiceState = Partial<Record<InspirationCategory, {
  candidateId: string
  choice: InspirationResultChoice | null
}>>

function BottomGarmentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current stroke-[1.8]">
      <path d="M8 3h8l1.5 18h-5L12 12l-.5 9h-5L8 3Z" strokeLinejoin="round" />
    </svg>
  )
}

type DetectionProgressProps = {
  sourceUrl: string | null
  error?: string | null
  onBack: () => void
}

function DetectionProgress({ sourceUrl, error, onBack }: DetectionProgressProps) {
  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <header className="relative flex h-14 shrink-0 items-center justify-center px-4 sm:h-16">
        <button
          type="button"
          aria-label="Back to import"
          className="absolute left-4 flex size-10 items-center justify-center"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Select pieces
        </span>
      </header>
      <section className="mx-auto min-h-0 w-full max-w-2xl flex-1 px-3 pb-3 pt-1 sm:px-5">
        <p className="mb-3 shrink-0 text-center text-xs font-semibold text-muted-foreground sm:mb-7">
          {error ? "We couldn’t identify the outfits" : "Looking for outfits…"}
        </p>
        <div
          className="relative mx-auto w-fit max-w-full overflow-hidden rounded-[8px] border border-hairline bg-card sm:w-full"
          aria-busy={!error}
        >
          {sourceUrl ? (
            <img
              src={sourceUrl}
              alt="Uploaded inspiration"
              className="block max-h-[calc(100dvh-21rem)] w-auto max-w-full sm:max-h-none sm:w-full"
            />
          ) : (
            <div className="flex h-[min(55dvh,32rem)] w-[min(90vw,40rem)] items-center justify-center px-8 text-center text-xs text-muted-foreground">
              Preparing your image…
            </div>
          )}
          {!error ? (
            <div className="pointer-events-none absolute inset-0 bg-foreground/5">
              <span
                aria-hidden="true"
                className="inspiration-scan-line absolute inset-x-0 z-10 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent"
              />
            </div>
          ) : null}
        </div>
        {!error ? (
          <p
            className="mt-3 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-terracotta"
            aria-live="polite"
          >
            <Loader2 className="size-3.5 animate-spin" /> Identifying pieces
          </p>
        ) : null}
        {error ? (
          <div className="mx-auto mt-4 max-w-md text-center" role="alert">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" className="mt-4" onClick={onBack}>
              <RotateCcw className="size-3.5" /> Try again
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default function InspirationImportScreen() {
  const { importId: routeImportId } = useParams<{ importId?: string }>()
  const isPreparingImport = routeImportId === PROCESSING_IMPORT_ID
  const importId = routeImportId && !isPreparingImport ? routeImportId : null
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { profile, gender } = useProfileContext()
  const productSaveActions = useProductSaveActions()
  const startImport = useStartInspirationImport()
  const importQuery = useInspirationImport(importId)
  const detectMutation = useDetectImportCandidates(importId ?? "")
  const selectMutation = useSelectImportCandidates(importId ?? "")
  const stageSelectionsMutation = useStageImportSelections(importId ?? "")
  const createDraftMutation = useCreateDraftOutfit()
  const openStudioMutation = useOpenInspirationImportInStudio(importId ?? "")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [pendingCandidateIds, setPendingCandidateIds] = useState<string[]>([])
  const [categoryChoices, setCategoryChoices] = useState<CategoryChoiceState>({})
  const [choosingCandidate, setChoosingCandidate] = useState(false)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)
  const [resultsSource, setResultsSource] = useState<"inventory" | "web">("inventory")
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null)
  const importStartTriggeredRef = useRef(false)
  const openedDraftRef = useRef<{ signature: string; outfitId: string } | null>(null)

  useEffect(() => {
    if (!sourceFile) {
      setSourcePreviewUrl(null)
      return
    }
    const nextUrl = URL.createObjectURL(sourceFile)
    setSourcePreviewUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [sourceFile])

  useEffect(() => {
    if (!isPreparingImport) {
      importStartTriggeredRef.current = false
      return
    }
    if (!sourceFile || importStartTriggeredRef.current) return

    importStartTriggeredRef.current = true
    startImport.mutate(sourceFile, {
      onSuccess: ({ importId: nextId }) => {
        navigate(`/inspiration-import/${nextId}`, { replace: true })
      },
    })
  }, [isPreparingImport, navigate, sourceFile, startImport])

  const record = importQuery.data
  const selectedCandidates = useMemo(() => {
    if (!record) return []
    const selectedIds = new Set(record.selectedCandidateIds)
    return record.candidates.filter((candidate) => selectedIds.has(candidate.id))
  }, [record])
  const selectedCandidate = selectedCandidates.find((item) => item.id === activeCandidateId)
    ?? selectedCandidates[0]
    ?? null
  const webQuery = useImportWebResults(importId ?? "", selectedCandidate?.id ?? null)
  const activeCandidateIdRef = useRef<string | null>(null)
  activeCandidateIdRef.current = selectedCandidate?.id ?? null
  const catalogueSearches = useImportCatalogueResults(record)
  const activeCatalogueSearch = catalogueSearches.find(({ candidate }) => candidate.id === selectedCandidate?.id)
  const catalogueResults = activeCatalogueSearch?.results ?? []
  const webResults = useMemo(() => {
    if (!selectedCandidate) return []
    const resultsByProviderId = new Map<string, InspirationWebResult>()
    for (const result of record?.webResults ?? []) {
      if (result.candidateId === selectedCandidate.id) resultsByProviderId.set(result.providerResultId, result)
    }
    for (const result of webQuery.data ?? []) {
      resultsByProviderId.set(result.providerResultId, result)
    }
    return [...resultsByProviderId.values()].sort((left, right) => left.rank - right.rank)
  }, [record?.webResults, selectedCandidate, webQuery.data])
  const choices = useMemo(() => selectedCandidates.reduce<Partial<Record<InspirationCategory, InspirationResultChoice | null>>>((result, candidate) => {
    const state = categoryChoices[candidate.category]
    result[candidate.category] = state?.candidateId === candidate.id ? state.choice : null
    return result
  }, {}), [categoryChoices, selectedCandidates])
  const activeChoice = selectedCandidate ? choices[selectedCandidate.category] ?? null : null
  const activePreviewId = activeChoice?.source === "inventory" ? activeChoice.result.id : null
  const activeWebProviderResultId = activeChoice?.source === "web"
    ? activeChoice.result.providerResultId
    : null
  const selectedTopId = choices.top?.source === "inventory" ? choices.top.result.id : null
  const selectedBottomId = choices.bottom?.source === "inventory" ? choices.bottom.result.id : null
  const selectedInventoryTotal = Number(Boolean(selectedTopId)) + Number(Boolean(selectedBottomId))
  const selectedWebTotal = Number(choices.top?.source === "web") + Number(choices.bottom?.source === "web")
  const selectedTotal = selectedInventoryTotal + selectedWebTotal

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

      const defaultCandidateIds = getDefaultCandidateIds(record.candidates)
      return defaultCandidateIds.length ? defaultCandidateIds : current
    })
  }, [record])

  useEffect(() => {
    if (!record) return
    setActiveCandidateId((current) => record.selectedCandidateIds.includes(current ?? "")
      ? current
      : record.selectedCandidateIds[0] ?? null)
  }, [record])

  useEffect(() => {
    setResultsSource("inventory")
  }, [selectedCandidate?.id])

  useEffect(() => {
    if (!record) return
    setCategoryChoices((current) => {
      const next = { ...current }
      let changed = false
      for (const category of ["top", "bottom"] as const) {
        const candidate = selectedCandidates.find((item) => item.category === category)
        if (!candidate) {
          if (next[category]) {
            delete next[category]
            changed = true
          }
          continue
        }
        if (next[category]?.candidateId === candidate.id) continue
        const search = catalogueSearches.find((item) => item.candidate.id === candidate.id)
        if (!search || search.isLoading) continue
        const persistedWeb = record.webResults.find((result) => result.candidateId === candidate.id)
        const persistedInventory = search.results.find((result) => (
          record.selections.catalogueProductIds.includes(result.id)
        ))
        const choice: InspirationResultChoice | null = persistedWeb
          ? { source: "web", result: persistedWeb }
          : persistedInventory
            ? { source: "inventory", result: persistedInventory }
            : search.results[0]
              ? { source: "inventory", result: search.results[0] }
              : null
        next[category] = { candidateId: candidate.id, choice }
        changed = true
      }
      return changed ? next : current
    })
  }, [catalogueSearches, record, selectedCandidates])

  const isCommitted = record?.import.status === "committed"
  const isStaged = record?.import.status === "selections_staged"
  const primaryError = validationError
    ?? startImport.error?.message
    ?? importQuery.error?.message
    ?? selectMutation.error?.message
    ?? catalogueSearches.find(({ error }) => error)?.error?.message
    ?? webQuery.error?.message
    ?? stageSelectionsMutation.error?.message
    ?? createDraftMutation.error?.message
    ?? openStudioMutation.error?.message
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
    startImport.reset()
    importStartTriggeredRef.current = false
    navigate(`/inspiration-import/${PROCESSING_IMPORT_ID}`)
  }

  const returnToSource = () => {
    startImport.reset()
    navigate("/inspiration-import", { replace: true })
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

  const showWebResults = async () => {
    if (!selectedCandidate) return
    const candidateId = selectedCandidate.id
    if (webQuery.data !== undefined) {
      setResultsSource("web")
      return
    }
    const result = await webQuery.refetch()
    if (!result.error && result.data !== undefined && activeCandidateIdRef.current === candidateId) {
      setResultsSource("web")
    }
  }

  const setCandidateChoice = (
    candidate: { id: string; category: InspirationCategory },
    choice: InspirationResultChoice | null,
  ) => {
    setCategoryChoices((current) => ({
      ...current,
      [candidate.category]: { candidateId: candidate.id, choice },
    }))
  }

  const selectInventoryResult = (result: InspirationCatalogueResult) => {
    if (!selectedCandidate) return
    const candidate = selectedCandidate
    if (!catalogueResults.some((item) => item.id === result.id)) return
    setValidationError(null)
    setCandidateChoice(candidate, toggleInventoryChoice(activeChoice, result))
  }

  const selectWebResult = (result: InspirationWebResult) => {
    if (!selectedCandidate) return
    const candidate = selectedCandidate
    setValidationError(null)
    setCandidateChoice(candidate, toggleWebChoice(activeChoice, result))
  }

  const showCandidateInventoryResults = (
    candidate: { id: string; category: InspirationCategory },
  ) => {
    setActiveCandidateId(candidate.id)
    setResultsSource("inventory")
    const previousChoice = choices[candidate.category] ?? null
    if (previousChoice?.source !== "web") return
    // Returning to Inventory clears the online choice. The category stays empty until the user
    // explicitly selects an inventory card, so that first click cannot be mistaken for a deselect.
    setCandidateChoice(candidate, null)
  }

  const showInventoryResults = () => {
    if (selectedCandidate) showCandidateInventoryResults(selectedCandidate)
  }

  const submitSelections = async () => {
    if (!user?.id || !selectedTotal) {
      setValidationError(user?.id ? "Choose at least one match." : "Sign in to open this look in Studio.")
      return
    }

    setValidationError(null)
    try {
      if (selectedWebTotal) {
        const webSelections = selectedCandidates.flatMap((candidate) => {
          const choice = choices[candidate.category]
          if (choice?.source !== "web" || !choice.result.selectionToken) return []
          return [{ candidateId: candidate.id, selectionToken: choice.result.selectionToken }]
        })
        const catalogueSelections = selectedCandidates.flatMap((candidate) => {
          const choice = choices[candidate.category]
          if (choice?.source !== "inventory") return []
          return [{ candidateId: candidate.id, productId: choice.result.id }]
        })
        if (webSelections.length !== selectedWebTotal) {
          throw new Error("An online result expired. Search online again and reselect it.")
        }
        await stageSelectionsMutation.mutateAsync({
          selections: webSelections,
          catalogueSelections,
        })
        return
      }

      const topProductId = selectedTopId
      const bottomProductId = selectedBottomId
      const studioSelectionSignature = `${topProductId ?? ""}:${bottomProductId ?? ""}`
      let draftId = openedDraftRef.current?.signature === studioSelectionSignature
        ? openedDraftRef.current.outfitId
        : null
      if (!draftId) {
        const draft = await createDraftMutation.mutateAsync({
          userId: user.id,
          topId: topProductId,
          bottomId: bottomProductId,
          gender,
          createdByName: profile?.name ?? null,
        })
        draftId = draft.id
        openedDraftRef.current = { signature: studioSelectionSignature, outfitId: draftId }
      }

      await openStudioMutation.mutateAsync({
        outfitId: draftId,
        topProductId,
        bottomProductId,
      })
      navigate(buildStudioUrl("/studio", "studio", { outfitId: draftId }))
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "The selected pieces could not be opened in Studio.")
    }
  }

  if (isPreparingImport) {
    return (
      <DetectionProgress
        sourceUrl={sourcePreviewUrl}
        error={!sourceFile ? "Choose an image before starting the import." : startImport.error?.message}
        onBack={returnToSource}
      />
    )
  }

  if (!importId) {
    return (
      <main className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="relative flex h-16 items-center justify-center px-5">
          <button
            type="button"
            aria-label="Back"
            className="absolute left-4 flex size-10 items-center justify-center"
            onClick={() => (location.key === "default" ? navigate("/collection") : navigate(-1))}
          >
            <ArrowLeft className="size-4" />
          </button>
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
    return sourcePreviewUrl ? (
      <DetectionProgress sourceUrl={sourcePreviewUrl} onBack={returnToSource} />
    ) : (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-terracotta" />
          <p className="mt-3 text-xs text-muted-foreground">Opening inspiration…</p>
        </div>
      </main>
    )
  }

  if (isCommitted || isStaged) {
    return (
      <main className="min-h-screen bg-background px-5 py-10 text-foreground">
        <section className="mx-auto max-w-lg rounded-frame border border-hairline bg-card p-7 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-gold text-gold">
            <Sparkles className="size-6" />
          </span>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
            {isStaged ? "Selections saved" : "Look captured"}
          </p>
          <h1 className="mt-2 font-display text-4xl font-medium">
            {isStaged ? "Ready for ingestion." : "Your look is ready."}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            {isStaged
              ? "Your selected online products and catalogue pieces are stored. The Studio outfit will be created after ingestion is available and completes successfully."
              : "Continue styling the selected pieces in Studio. Favorites and Wardrobe remain independent."}
          </p>
          <div className="mt-7 space-y-2 border-y border-hairline py-5 text-left text-sm">
            <div className="flex justify-between"><span>Catalogue items</span><span>{record.selections.catalogueProductIds.length}</span></div>
            <div className="flex justify-between"><span>Online items</span><span>{record.selections.webResultIds.length || "None"}</span></div>
          </div>
          <Button
            className="mt-7 w-full bg-terracotta text-white hover:bg-terracotta/90"
            onClick={() => !isStaged && record.import.studioOutfitId
              ? navigate(buildStudioUrl("/studio", "studio", { outfitId: record.import.studioOutfitId }))
              : navigate("/inspiration-import")}
          >
            {!isStaged && record.import.studioOutfitId ? "Open in Studio" : "Import another look"}
          </Button>
        </section>
      </main>
    )
  }

  if (record.import.status === "detecting" || record.import.status === "source_ready") {
    return (
      <DetectionProgress
        sourceUrl={record.sourceUrl ?? sourcePreviewUrl}
        onBack={returnToSource}
      />
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
        <span className="w-10" aria-hidden="true" />
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
            <div className="grid h-[clamp(18rem,50dvh,28rem)] grid-cols-2 gap-3 sm:h-auto sm:aspect-[3/2]">
              <div className="relative overflow-hidden rounded-[7px] border border-hairline bg-card">
                {record.sourceUrl ? <img src={record.sourceUrl} alt="Uploaded inspiration reference" className="h-full w-full object-cover" /> : null}
                <span className="absolute left-3 top-3 rounded-[3px] bg-foreground px-2 py-1 text-[8px] font-bold uppercase tracking-[0.12em] text-background">
                  Ref
                </span>
              </div>
              <ImportMannequinPreview
                choices={choices}
                activeCategory={selectedCandidate.category}
                resultsSource={resultsSource}
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
                        showCandidateInventoryResults(candidate)
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
                  onClick={showInventoryResults}
                >
                  <ChevronLeft className="size-3" /> Inventory
                </button>
              ) : (
                <button
                  type="button"
                  className="flex h-9 items-center gap-1 rounded-[5px] border border-hairline bg-card px-3 text-[9px] font-semibold uppercase tracking-[0.13em] text-foreground disabled:cursor-wait disabled:text-muted-foreground"
                  onClick={() => void showWebResults()}
                  disabled={webQuery.isFetching}
                >
                  {webQuery.isFetching ? <Loader2 className="size-3 animate-spin" /> : null}
                  {webQuery.isFetching ? "Searching" : "Web search"}
                  {webQuery.isFetching ? null : <ChevronRight className="size-3" />}
                </button>
              )}
            </div>

            <div className="mt-2 min-w-0 sm:mt-4">
              {resultsSource === "web" ? (
                webResults.length ? (
                  <WebMatchRack
                    results={webResults}
                    selectedId={activeWebProviderResultId}
                    onSelect={selectWebResult}
                  />
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
                  selectedId={activePreviewId}
                  isFavorite={productSaveActions.isSaved}
                  isInWardrobe={productSaveActions.isInWardrobe}
                  isSaving={productSaveActions.isSaving}
                  onSelect={selectInventoryResult}
                  onToggleFavorite={(id, nextSaved, position) => void productSaveActions.onToggleSave(
                    id,
                    nextSaved,
                    { layout: "horizontal_rail", position },
                  )}
                  onToggleWardrobe={(id, nextSaved, position) => void productSaveActions.onToggleWardrobe(
                    id,
                    nextSaved,
                    { layout: "horizontal_rail", position },
                  )}
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
              disabled={!selectedTotal || stageSelectionsMutation.isPending || createDraftMutation.isPending || openStudioMutation.isPending}
              onClick={() => void submitSelections()}
            >
              {stageSelectionsMutation.isPending || createDraftMutation.isPending || openStudioMutation.isPending
                ? <Loader2 className="size-4 animate-spin" />
                : <Sparkles className="size-4" />}
              {selectedWebTotal
                ? "Save selections for ingestion"
                : selectedInventoryTotal
                ? `Open ${selectedInventoryTotal === 1 ? "piece" : "look"} in Studio`
                : "Select pieces to continue"}
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
