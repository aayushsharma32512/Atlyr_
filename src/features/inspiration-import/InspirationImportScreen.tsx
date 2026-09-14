import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, RotateCcw, Sparkles } from "lucide-react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { Icons } from "@/design-system/icons"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { CandidatePicker } from "@/features/inspiration-import/components/CandidatePicker"
import {
  ImportMannequinPreview,
} from "@/features/inspiration-import/components/ImportMannequinPreview"
import { ImportRack } from "@/features/inspiration-import/components/ImportRack"
import { InspirationSourceInput, type InspirationIntent } from "@/features/inspiration-import/components/InspirationSourceInput"
import { getDefaultCandidateIds } from "@/features/inspiration-import/candidateSelection"
import { cutoutToFile } from "@/features/inspiration-import/cutoutToFile"
import { inspirationImportService } from "@/services/inspirationImport/inspirationImportService"
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

const PRIMARY =
  "flex h-11 flex-1 items-center justify-center gap-2 rounded-control bg-primary text-card font-medium text-primary-foreground disabled:opacity-40"
const SECONDARY =
  "flex h-11 flex-1 items-center justify-center gap-2 rounded-control border border-hairline bg-white text-card font-medium text-ink disabled:opacity-40"
const TOGGLE =
  "inline-flex h-7 flex-none items-center gap-1 rounded-control border border-hairline bg-white px-2.5 text-chip font-medium text-ink disabled:opacity-50"

/** The 52px header row every step shares: back, the step's name, a meta line on the right. */
function ImportHeader({ title, meta, onBack }: { title: string; meta?: string; onBack: () => void }) {
  return (
    <header className="flex h-control-header-title flex-none items-center gap-1 border-b border-hairline pl-2 pr-4">
      <button type="button" aria-label="Back" onClick={onBack} className="flex h-9 w-9 flex-none items-center justify-center text-ink">
        <Icons.carouselPrev className="h-5 w-5" aria-hidden="true" />
      </button>
      <h1 className="min-w-0 flex-1 truncate font-display text-title font-medium text-ink">{title}</h1>
      {meta ? <span className="flex-none text-chip tabular-nums text-taupe">{meta}</span> : null}
    </header>
  )
}

type DetectionProgressProps = {
  sourceUrl: string | null
  error?: string | null
  onBack: () => void
  /** Hands the job to the floating hub and leaves — it is tracked, so it lands in Notifications. */
  onMinimise?: () => void
}

/** Detecting: the photo on the ground with a violet scan line, the voice saying what is happening. */
function DetectionProgress({ sourceUrl, error, onBack, onMinimise }: DetectionProgressProps) {
  return (
    <AppShellLayout>
      <div className="flex flex-col overflow-hidden bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
        <ImportHeader title="Find items" meta={error ? undefined : "detecting…"} onBack={onBack} />
        <div className="relative min-h-0 flex-1 px-4 py-3">
          <div className="relative flex h-full items-center justify-center overflow-hidden rounded-control" aria-busy={!error}>
            {sourceUrl ? (
              <img src={sourceUrl} alt="Your inspiration" className="block max-h-full w-auto max-w-full" />
            ) : (
              <p className="text-chip text-taupe">Preparing your image…</p>
            )}
            {!error ? (
              <span
                aria-hidden="true"
                className="inspiration-scan-line absolute inset-x-0 z-10 h-0.5 bg-gradient-to-r from-transparent via-violet to-transparent"
              />
            ) : null}
          </div>
        </div>
        <div className="flex flex-none flex-col gap-3 border-t border-hairline px-4 pb-4 pt-3">
          {error ? (
            <div className="flex items-center justify-between gap-3" role="alert">
              <p className="min-w-0 text-chip text-destructive">{error}</p>
              <button type="button" onClick={onBack} className={cn(TOGGLE, "h-9")}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> try again
              </button>
            </div>
          ) : (
            <p className="font-voice text-body italic text-charcoal" aria-live="polite">
              Finding the pieces in your photo…
            </p>
          )}
          {!error && onMinimise ? (
            <button type="button" onClick={onMinimise} className={SECONDARY}>
              <Icons.collapse className="h-[18px] w-[18px]" aria-hidden="true" />
              minimise
            </button>
          ) : null}
        </div>
      </div>
    </AppShellLayout>
  )
}

export default function InspirationImportScreen() {
  const { importId: routeImportId } = useParams<{ importId?: string }>()
  const isPreparingImport = routeImportId === PROCESSING_IMPORT_ID
  const importId = routeImportId && !isPreparingImport ? routeImportId : null
  const navigate = useNavigate()
  const location = useLocation()
  // Boards' "+" card sends ?intent=wardrobe; the copy changes, the flow does not.
  const intent: InspirationIntent = new URLSearchParams(location.search).get("intent") === "wardrobe" ? "wardrobe" : "inspiration"
  // Seeded entry: ?source=<cutout url>&slot=top|bottom, once for the globe on a
  // piece, twice (top then bottom) for Studio's Find items; plus &results=web
  // from the rack's "web search" row. The cutouts are seeded as the selected
  // candidates and the screen opens straight on the rack.
  const seedParams = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const sources = params.getAll("source")
    const slots = params.getAll("slot")
    const pieces = sources.map((source, index) => {
      const slotParam = slots[index]
      const slot: InspirationCategory = slotParam === "bottom" ? "bottom" : slotParam === "top" ? "top" : index === 0 ? "top" : "bottom"
      return { source, slot }
    })
    return pieces.length
      ? { pieces, results: params.get("results") === "web" ? ("web" as const) : ("inventory" as const) }
      : null
  }, [location.search])
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
  const [pickError, setPickError] = useState<string | null>(null)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)
  // Web first: the rack opens on the Lens results, inventory is the option.
  const [resultsSource, setResultsSource] = useState<"inventory" | "web">("web")
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null)
  const importStartTriggeredRef = useRef(false)
  const seededRef = useRef(false)
  // The seeding promise outlives renders; this is the only "still here" check it needs.
  const mountedRef = useRef(true)
  useEffect(() => {
    // StrictMode mounts, unmounts and remounts once in dev: the flag must be
    // set on every mount, not only cleared on unmount, or the remount stays "gone".
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const autoRef = useRef<{ slot: InspirationCategory | null; results: "inventory" | "web" } | null>(null)
  const [isSeeding, setIsSeeding] = useState(false)
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
    if (importId || isPreparingImport || !seedParams || seededRef.current) return
    // Runs exactly once per seeded URL: no cleanup flag, because a re-render
    // (which setIsSeeding itself causes) must not orphan the in-flight fetch.
    seededRef.current = true
    autoRef.current = { slot: seedParams.pieces[0]?.slot ?? null, results: seedParams.results }
    setIsSeeding(true)
    console.log("[find-items] 0/5 seeding", seedParams)
    Promise.all(seedParams.pieces.map((piece) => cutoutToFile(piece.source)))
      .then((files) => {
        if (!mountedRef.current) return
        setValidationError(null)
        setSourceFile(files[0] ?? null)
        // No detector: the cutouts are uploaded as the candidates themselves and
        // the import opens straight on the rack.
        const pieces = files.map((file, index) => ({ file, category: seedParams.pieces[index].slot }))
        return inspirationImportService.startSeededImport(pieces).then(({ importId: nextId }) => {
          if (!mountedRef.current) return
          console.log("[find-items] opening rack", { importId: nextId })
          navigate(`/inspiration-import/${nextId}`, { replace: true })
        })
      })
      .catch((error: unknown) => {
        console.error("[find-items] FAILED", error)
        if (!mountedRef.current) return
        autoRef.current = null
        setValidationError(error instanceof Error ? error.message : "Couldn't load this piece's image.")
      })
      .finally(() => {
        setIsSeeding(false)
      })
  }, [importId, isPreparingImport, navigate, seedParams])

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
  const refetchWeb = webQuery.refetch
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
    console.log("[find-items] record", {
      status: record.import.status, error: record.import.errorCode,
      candidates: record.candidates.map((c) => ({ id: c.id, category: c.category, selected: c.selected })),
      selected: record.selectedCandidateIds, webResults: record.webResults.length,
    })
  }, [record])

  useEffect(() => {
    if (!record) return
    setActiveCandidateId((current) => record.selectedCandidateIds.includes(current ?? "")
      ? current
      : record.selectedCandidateIds[0] ?? null)
  }, [record])

  useEffect(() => {
    setResultsSource("web")
  }, [selectedCandidate?.id])

  // The Lens search runs the moment a candidate is shown in web mode. The query
  // is manual (enabled: false), so flipping to inventory and back never refires it.
  useEffect(() => {
    if (!selectedCandidate || resultsSource !== "web") return
    if (webQuery.data !== undefined || webQuery.isFetching || webQuery.isError) return
    void refetchWeb()
  }, [refetchWeb, resultsSource, selectedCandidate, webQuery.data, webQuery.isError, webQuery.isFetching])

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

  // Leaves the flow. The seed and processing hops replace their history entry,
  // so one step back lands on whatever opened the import — Studio, Search or Boards.
  const exitImport = useCallback(() => {
    if (location.key === "default") navigate(intent === "wardrobe" ? "/collection" : "/search")
    else navigate(-1)
  }, [intent, location.key, navigate])

  const toggleCandidate = (candidateId: string) => {
    const candidate = record?.candidates.find((item) => item.id === candidateId)
    if (!candidate) return
    setPickError(null)
    if (pendingCandidateIds.includes(candidateId)) {
      setPendingCandidateIds((current) => current.filter((id) => id !== candidateId))
      return
    }
    // One per category (design: Find items · Pieces). A second pick for a
    // filled slot is rejected with a line, not silently swapped in.
    const taken = pendingCandidateIds.some(
      (id) => record.candidates.find((item) => item.id === id)?.category === candidate.category,
    )
    if (taken) {
      setPickError(candidate.category === "top" ? "one top at a time — clear the slot first" : "one lower at a time — clear the slot first")
      return
    }
    setPendingCandidateIds((current) => [...current, candidateId])
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
      <AppShellLayout>
        <div className="flex flex-col bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
          <ImportHeader
            title={intent === "wardrobe" ? "Add to wardrobe" : "Import inspiration"}
            onBack={exitImport}
          />
          <InspirationSourceInput
            file={sourceFile}
            isPending={startImport.isPending || isSeeding}
            error={primaryError}
            intent={intent}
            onFile={onFile}
          />
          {/* Dimmed until a photo is in. */}
          <div className="flex h-[72px] flex-none items-center gap-2 border-t border-hairline bg-background px-4 pb-4 pt-3">
            <button type="button" disabled={!sourceFile || startImport.isPending || isSeeding} onClick={submitSource} className={PRIMARY}>
              {startImport.isPending || isSeeding ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
              ) : (
                <Icons.search className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
              identify items
            </button>
          </div>
        </div>
      </AppShellLayout>
    )
  }

  if (importQuery.isLoading || !record) {
    if (importQuery.isError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-5">
          <section className="w-full max-w-md rounded-control border border-hairline p-6 text-center" role="alert">
            <h1 className="font-display text-title font-medium text-ink">This import couldn’t be opened.</h1>
            <p className="mt-2 text-chip text-taupe">{importQuery.error.message}</p>
            <button type="button" className={cn(PRIMARY, "mt-6 w-full")} onClick={() => navigate("/inspiration-import")}>start a new import</button>
          </section>
        </main>
      )
    }
    return sourcePreviewUrl ? (
      <DetectionProgress sourceUrl={sourcePreviewUrl} onBack={returnToSource} onMinimise={() => navigate("/collection")} />
    ) : (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-ink" />
          <p className="mt-3 text-chip text-taupe">Opening inspiration…</p>
        </div>
      </main>
    )
  }

  if (isCommitted || isStaged) {
    return (
      <main className="min-h-screen bg-background px-4 py-10 text-foreground">
        <section className="mx-auto max-w-lg rounded-control border border-hairline p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-control border border-hairline bg-white text-violet">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-4 text-chip text-taupe">{isStaged ? "selections saved" : "look captured"}</p>
          <h1 className="mt-1 font-display text-title font-medium text-ink">
            {isStaged ? "Ready for ingestion." : "Your look is ready."}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-body text-taupe">
            {isStaged
              ? "Your selected online products and catalogue pieces are stored. The Studio outfit will be created after ingestion completes."
              : "Continue styling the selected pieces in Studio. Favourites and Wardrobe stay as they are."}
          </p>
          <div className="mt-6 flex flex-col gap-2 border-y border-hairline py-4 text-left text-card text-ink">
            <div className="flex justify-between"><span>catalogue items</span><span className="tabular-nums">{record.selections.catalogueProductIds.length}</span></div>
            <div className="flex justify-between"><span>online items</span><span className="tabular-nums">{record.selections.webResultIds.length || "none"}</span></div>
          </div>
          <button
            type="button"
            className={cn(PRIMARY, "mt-6 w-full")}
            onClick={() => !isStaged && record.import.studioOutfitId
              ? navigate(buildStudioUrl("/studio", "studio", { outfitId: record.import.studioOutfitId }))
              : navigate("/inspiration-import")}
          >
            <Icons.studio className="h-[18px] w-[18px]" aria-hidden="true" />
            {!isStaged && record.import.studioOutfitId ? "open in Studio" : "import another look"}
          </button>
        </section>
      </main>
    )
  }

  if (record.import.status === "detecting" || record.import.status === "source_ready") {
    return (
      <DetectionProgress
        sourceUrl={record.sourceUrl ?? sourcePreviewUrl}
        onBack={returnToSource}
        onMinimise={() => navigate("/collection")}
      />
    )
  }

  const isChoosingCandidate = !selectedCandidate || choosingCandidate
  const foundCategories = new Set(record.candidates.map((candidate) => candidate.category)).size
  const submitting =
    stageSelectionsMutation.isPending || createDraftMutation.isPending || openStudioMutation.isPending

  return (
    <AppShellLayout>
      <div className="flex flex-col overflow-hidden bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
        <ImportHeader
          title="Find items"
          meta={
            isChoosingCandidate
              ? `${foundCategories} of 3 found`
              : resultsSource === "web"
                ? `${webResults.length} online`
                : `${catalogueResults.length} matches`
          }
          onBack={() => {
            // Rack → Pieces only when there is a garment to re-pick. A seeded product
            // import has the one candidate, so its back leaves instead of bouncing
            // between the two views forever.
            if (!isChoosingCandidate && record.candidates.length > 1) setChoosingCandidate(true)
            else exitImport()
          }}
        />

        {isChoosingCandidate ? (
          record.sourceUrl ? (
            <CandidatePicker
              sourceUrl={record.sourceUrl}
              candidates={record.candidates}
              selectedIds={pendingCandidateIds}
              error={pickError}
              onSelect={toggleCandidate}
            />
          ) : null
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Top view: your crop beside the figure wearing the pick. No callouts — the
                violet border on the chosen tile is the only marker. */}
            <div className="grid h-[272px] flex-none grid-cols-2 gap-3 px-4 pt-3">
              <div className="relative overflow-hidden rounded-chip bg-background">
                {selectedCandidate.retrievalCropUrl ? (
                  <img src={selectedCandidate.retrievalCropUrl} alt="Your pick" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <ImportMannequinPreview
                choices={choices}
                activeCategory={selectedCandidate.category}
                resultsSource={resultsSource}
              />
            </div>

            {/* Slot tabs, violet underline; kicks is not detected, so it reads dimmed. The
                source toggle sits on the right and flips with a chevron. */}
            <div className="mx-4 flex h-9 flex-none items-center justify-between border-b border-hairline">
              <div className="flex items-center gap-1.5" role="tablist" aria-label="Slot">
                {(["top", "bottom"] as const).map((category) => {
                  const candidate = selectedCandidates.find((item) => item.category === category)
                  const active = candidate?.id === selectedCandidate.id
                  const Glyph = category === "top" ? Icons.slotTop : Icons.slotBottom
                  return (
                    <button
                      key={category}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={category === "top" ? "tops" : "lowers"}
                      disabled={!candidate}
                      onClick={() => candidate && setActiveCandidateId(candidate.id)}
                      className={cn(
                        "flex h-[26px] w-10 items-center justify-center border-b-2",
                        active ? "border-violet text-ink" : "border-transparent text-ink",
                        !candidate && "text-taupe",
                      )}
                    >
                      <Glyph className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )
                })}
                <span aria-label="kicks — not detected" className="flex h-[26px] w-10 items-center justify-center text-disabled">
                  <Icons.slotShoes className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              {resultsSource === "web" ? (
                <button type="button" onClick={showInventoryResults} className={TOGGLE}>
                  inventory
                  <Icons.carouselNext className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : (
                <button type="button" onClick={() => setResultsSource("web")} className={TOGGLE}>
                  <Icons.carouselPrev className="h-3.5 w-3.5" aria-hidden="true" />
                  web search
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
              {resultsSource === "web" ? (
                webResults.length ? (
                  <ImportRack kind="web" results={webResults} selectedId={activeWebProviderResultId} onSelect={selectWebResult} />
                ) : webQuery.isFetching ? (
                  <div className="flex min-h-40 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
                  </div>
                ) : (
                  <p className="px-4 py-8 text-center text-body text-taupe">
                    {webQuery.isError ? "Online search failed — try inventory." : "No online matches for this piece."}
                  </p>
                )
              ) : activeCatalogueSearch?.isLoading ? (
                <div className="flex min-h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
                </div>
              ) : (
                <ImportRack
                  kind="catalogue"
                  results={catalogueResults}
                  selectedId={activePreviewId}
                  isFavorite={productSaveActions.isSaved}
                  isSaving={productSaveActions.isSaving}
                  onSelect={selectInventoryResult}
                  onToggleFavorite={(id, nextSaved, position) =>
                    void productSaveActions.onToggleSave(id, nextSaved, { layout: "vertical_grid", position })
                  }
                />
              )}
            </div>
          </div>
        )}

        {primaryError ? (
          <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2" role="alert">
            <p className="min-w-0 text-chip text-destructive">{primaryError}</p>
            {record.import.status === "failed" ? (
              <button type="button" className={cn(TOGGLE, "h-9")} onClick={() => detectMutation.mutate()} disabled={detectMutation.isPending}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> retry
              </button>
            ) : null}
          </div>
        ) : null}

        {/* The tray: one ink action, named for what comes next. */}
        <div className="flex h-[76px] flex-none items-center gap-3 border-t border-hairline bg-background px-4 pb-2">
          {isChoosingCandidate ? (
            <button
              type="button"
              className={PRIMARY}
              disabled={!pendingCandidateIds.length || selectMutation.isPending}
              onClick={() =>
                pendingCandidateIds.length &&
                selectMutation.mutate(pendingCandidateIds, { onSuccess: () => setChoosingCandidate(false) })
              }
            >
              {selectMutation.isPending ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
              ) : (
                <Icons.search className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
              find matches · {pendingCandidateIds.length}
            </button>
          ) : (
            <button type="button" className={PRIMARY} disabled={!selectedTotal || submitting} onClick={() => void submitSelections()}>
              {submitting ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
              ) : (
                <Icons.findItems className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
              proceed · {selectedTotal}
            </button>
          )}
        </div>
      </div>
    </AppShellLayout>
  )
}
