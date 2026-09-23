import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, RotateCcw } from "lucide-react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { Icons } from "@/design-system/icons"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { useSaveTray } from "@/features/collections/providers/SaveTrayProvider"
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
} from "@/features/inspiration-import/selectionTransitions"
import {
  useDetectImportCandidates,
  useImportCatalogueResults,
  useImportWebResults,
  useInspirationImport,
  useOpenInspirationImportInStudio,
  useSelectImportCandidates,
  useAddImportWebSelections,
  useStartInspirationImport,
} from "@/features/inspiration-import/hooks/useInspirationImport"
import { useSlowSearchNotice } from "@/features/inspiration-import/hooks/useSlowSearchNotice"
import { useCreateDraftOutfit } from "@/features/outfits/hooks/useCreateDraftOutfit"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useToast } from "@/hooks/use-toast"
import { buildStudioUrl } from "@/features/studio/utils/studioUrlState"
import type {
  InspirationCatalogueResult,
  InspirationCategory,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const PROCESSING_IMPORT_ID = "processing"

// Inventory and Web are two fully independent picks per category, not one shared slot. Inventory
// alone drives the mannequin; Web alone drives the "Online pick" card. Switching between the two
// rails, or selecting/deselecting a Web result, never touches the other pick.
type CategoryChoiceState = Partial<Record<InspirationCategory, {
  candidateId: string
  inventoryChoice: InspirationCatalogueResult | null
  webChoice: InspirationWebResult | null
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
  meta?: string
  voice?: string
  onBack: () => void
  /** Hands the job to the floating hub and leaves — it is tracked, so it lands in Notifications. */
  onMinimise?: () => void
}

/** Detecting: the photo on the ground with a violet scan line, the voice saying what is happening. */
function DetectionProgress({
  sourceUrl,
  error,
  meta = "detecting…",
  voice = "Finding the pieces in your photo…",
  onBack,
  onMinimise,
}: DetectionProgressProps) {
  return (
    <AppShellLayout>
      <div className="flex flex-col overflow-hidden bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
        <ImportHeader title="Find items" meta={error ? undefined : meta} onBack={onBack} />
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
              {voice}
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
  // piece, twice (top then bottom) for Studio's Find items. The cutouts are seeded
  // as the selected candidates and the screen opens on the rack's web results.
  const seedParams = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const sources = params.getAll("source")
    const slots = params.getAll("slot")
    const pieces = sources.map((source, index) => {
      const slotParam = slots[index]
      const slot: InspirationCategory = slotParam === "bottom" ? "bottom" : slotParam === "top" ? "top" : index === 0 ? "top" : "bottom"
      return { source, slot }
    })
    return pieces.length ? { pieces } : null
  }, [location.search])
  const { user } = useAuth()
  const { profile, gender } = useProfileContext()
  const productSaveActions = useProductSaveActions()
  const { openPieceSave } = useSaveTray()
  const startImport = useStartInspirationImport()
  const importQuery = useInspirationImport(importId)
  const detectMutation = useDetectImportCandidates(importId ?? "")
  const selectMutation = useSelectImportCandidates(importId ?? "")
  const addWebSelectionsMutation = useAddImportWebSelections(importId ?? "")
  const { toast } = useToast()
  const createDraftMutation = useCreateDraftOutfit()
  const openStudioMutation = useOpenInspirationImportInStudio(importId ?? "")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [pendingCandidateIds, setPendingCandidateIds] = useState<string[]>([])
  const [categoryChoices, setCategoryChoices] = useState<CategoryChoiceState>({})
  const [choosingCandidate, setChoosingCandidate] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)
  // Each garment remembers its own rail, so switching tabs returns to where the user left off.
  // Both rails preload (see the webQueries hook below); the default rail is chosen at resultsSource.
  const [railByCandidate, setRailByCandidate] = useState<Record<string, "inventory" | "web">>({})
  const setCandidateRail = (candidateId: string, source: "inventory" | "web") =>
    setRailByCandidate((current) => current[candidateId] === source ? current : { ...current, [candidateId]: source })
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
  const [isSeeding, setIsSeeding] = useState(false)
  // A Studio-seeded import has no photo to detect on: its scan runs over the still of the figure
  // that Find items handed over, until the first online answer is in.
  const [seededFlow, setSeededFlow] = useState(false)
  const [figureUrl] = useState(() => (location.state as { figure?: string } | null)?.figure ?? null)
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
    setIsSeeding(true)
    setSeededFlow(true)
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
  // Preloads Web search for every selected candidate (top and/or bottom) in parallel, regardless
  // of which tab is showing — so switching to Web later shows what's already there instead of
  // starting the search from zero.
  const webQueries = useImportWebResults(importId ?? "", selectedCandidates)
  const webQuery = webQueries.find((query) => query.candidateId === selectedCandidate?.id)
    ?? { candidateId: null, data: undefined, error: null, isFetching: false, isPending: false, isError: false, refetch: () => undefined }
  const webQueryIsSlow = useSlowSearchNotice(webQuery.isFetching)
  // The Studio scan covers the arrival only: the piece the rack opens on. Other tabs show their own spinner.
  const landingWebQuery = webQueries.find((query) => query.candidateId === record?.selectedCandidateIds[0])
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
  // Persisted web rows are the listings already sent to the Atlyr team: one per garment, then locked.
  const addedWebIds = useMemo(() => new Set((record?.webResults ?? []).map((result) => result.providerResultId)), [record?.webResults])
  const addedCandidateIds = useMemo(() => new Set((record?.webResults ?? []).map((result) => result.candidateId)), [record?.webResults])
  const inventoryChoices = useMemo(() => selectedCandidates.reduce<Partial<Record<InspirationCategory, InspirationCatalogueResult | null>>>((result, candidate) => {
    const state = categoryChoices[candidate.category]
    result[candidate.category] = state?.candidateId === candidate.id ? state.inventoryChoice ?? null : null
    return result
  }, {}), [categoryChoices, selectedCandidates])
  const webChoices = useMemo(() => selectedCandidates.reduce<Partial<Record<InspirationCategory, InspirationWebResult | null>>>((result, candidate) => {
    const state = categoryChoices[candidate.category]
    result[candidate.category] = state?.candidateId === candidate.id ? state.webChoice ?? null : null
    return result
  }, {}), [categoryChoices, selectedCandidates])
  const activePreviewId = selectedCandidate ? inventoryChoices[selectedCandidate.category]?.id ?? null : null
  const activeWebProviderResultId = selectedCandidate
    ? webChoices[selectedCandidate.category]?.providerResultId ?? null
    : null
  // Inventory picks go to Studio, Web picks go to the Atlyr team; the two never compete.
  const selectedTopId = inventoryChoices.top?.id ?? null
  const selectedBottomId = inventoryChoices.bottom?.id ?? null
  const selectedInventoryTotal = Number(Boolean(selectedTopId)) + Number(Boolean(selectedBottomId))
  const selectedWebTotal = Number(Boolean(webChoices.top)) + Number(Boolean(webChoices.bottom))

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

  // Studio's Find items lands on web results, unless that search failed or found nothing.
  const webUsable = !webQuery.isError && (webQuery.data === undefined || webResults.length > 0)
  const resultsSource = (selectedCandidate ? railByCandidate[selectedCandidate.id] : undefined)
    ?? (seededFlow && webUsable ? "web" : "inventory")
  const setResultsSource = (source: "inventory" | "web") => {
    if (selectedCandidate) setCandidateRail(selectedCandidate.id, source)
  }

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
        const persistedInventory = search.results.find((result) => (
          record.selections.catalogueProductIds.includes(result.id)
        ))
        const inventoryChoice = persistedInventory ?? search.results[0] ?? null
        next[category] = { candidateId: candidate.id, inventoryChoice, webChoice: null }
        changed = true
      }
      return changed ? next : current
    })
  }, [catalogueSearches, record, selectedCandidates])

  const primaryError = validationError
    ?? startImport.error?.message
    ?? importQuery.error?.message
    ?? selectMutation.error?.message
    ?? catalogueSearches.find(({ error }) => error)?.error?.message
    ?? webQuery.error?.message
    ?? addWebSelectionsMutation.error?.message
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


  const setCandidateInventoryChoice = (
    candidate: { id: string; category: InspirationCategory },
    inventoryChoice: InspirationCatalogueResult | null,
  ) => {
    setCategoryChoices((current) => {
      const state = current[candidate.category]
      return {
        ...current,
        [candidate.category]: {
          candidateId: candidate.id,
          inventoryChoice,
          webChoice: state?.candidateId === candidate.id ? state.webChoice ?? null : null,
        },
      }
    })
  }

  const setCandidateWebChoice = (
    candidate: { id: string; category: InspirationCategory },
    webChoice: InspirationWebResult | null,
  ) => {
    setCategoryChoices((current) => {
      const state = current[candidate.category]
      return {
        ...current,
        [candidate.category]: {
          candidateId: candidate.id,
          inventoryChoice: state?.candidateId === candidate.id ? state.inventoryChoice ?? null : null,
          webChoice,
        },
      }
    })
  }

  const selectInventoryResult = (result: InspirationCatalogueResult) => {
    if (!selectedCandidate) return
    const candidate = selectedCandidate
    if (!catalogueResults.some((item) => item.id === result.id)) return
    setValidationError(null)
    const current = inventoryChoices[candidate.category] ?? null
    setCandidateInventoryChoice(candidate, toggleInventoryChoice(current, result))
  }

  const selectWebResult = (result: InspirationWebResult) => {
    if (!selectedCandidate) return
    const candidate = selectedCandidate
    if (addedCandidateIds.has(candidate.id) || addedWebIds.has(result.providerResultId)) return
    setValidationError(null)
    const current = webChoices[candidate.category] ?? null
    setCandidateWebChoice(candidate, toggleWebChoice(current, result))
  }

  // Only switches which rail (Inventory vs Web) and which category tab is showing. Neither pick
  // is read or written here — the mannequin never needs to change because of this.
  const showCandidateInventoryResults = (
    candidate: { id: string; category: InspirationCategory },
  ) => {
    setActiveCandidateId(candidate.id)
    setCandidateRail(candidate.id, "inventory")
  }

  const showInventoryResults = () => {
    if (selectedCandidate) showCandidateInventoryResults(selectedCandidate)
  }

  const addToAtlyr = async () => {
    if (!user?.id || !selectedWebTotal) return
    setValidationError(null)
    const webSelections = selectedCandidates.flatMap((candidate) => {
      const webChoice = webChoices[candidate.category]
      if (!webChoice?.selectionToken) return []
      return [{ candidateId: candidate.id, selectionToken: webChoice.selectionToken }]
    })
    if (webSelections.length !== selectedWebTotal) {
      setValidationError("An online result expired. Search online again and reselect it.")
      return
    }
    try {
      await addWebSelectionsMutation.mutateAsync({ selections: webSelections })
      for (const candidate of selectedCandidates) setCandidateWebChoice(candidate, null)
      toast({ title: "Added to Atlyr", description: "The Atlyr team will review and add it to Atlyr's inventory." })
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "The online picks could not be saved.")
    }
  }

  const openInStudio = async () => {
    if (!user?.id || !selectedInventoryTotal) {
      setValidationError(user?.id ? "Choose at least one inventory match." : "Sign in to open this look in Studio.")
      return
    }
    setValidationError(null)
    try {
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

  const seededScan = (
    <DetectionProgress
      sourceUrl={figureUrl ?? sourcePreviewUrl}
      meta="searching…"
      voice="Looking for these pieces online…"
      onBack={exitImport}
    />
  )
  if (!importId && seedParams && !primaryError) return seededScan

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
    if (seededFlow) return seededScan
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

  if (record.import.status === "detecting" || record.import.status === "source_ready") {
    if (seededFlow) return seededScan
    return (
      <DetectionProgress
        sourceUrl={record.sourceUrl ?? sourcePreviewUrl}
        onBack={returnToSource}
        onMinimise={() => navigate("/collection")}
      />
    )
  }

  if (seededFlow && landingWebQuery?.isPending) return seededScan

  const isChoosingCandidate = !selectedCandidate || choosingCandidate
  const foundCategories = new Set(record.candidates.map((candidate) => candidate.category)).size
  const addingToAtlyr = addWebSelectionsMutation.isPending
  const openingStudio = createDraftMutation.isPending || openStudioMutation.isPending

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
            // Rack → Pieces only when there is a photo to re-pick from. A Studio-seeded
            // import's candidates are the worn pieces themselves, so its back leaves.
            if (!isChoosingCandidate && !seededFlow && record.candidates.length > 1) setChoosingCandidate(true)
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
                inventoryChoices={inventoryChoices}
                activeCategory={selectedCandidate.category}
                activeWebChoice={webChoices[selectedCandidate.category] ?? null}
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
                  <ImportRack
                    kind="web"
                    results={webResults}
                    selectedId={activeWebProviderResultId}
                    addedIds={addedWebIds}
                    locked={addedCandidateIds.has(selectedCandidate.id)}
                    onSelect={selectWebResult}
                  />
                ) : webQuery.isFetching ? (
                  webQueryIsSlow ? (
                    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center">
                      <p className="text-body text-taupe">Web search is taking longer than expected</p>
                      <button type="button" className={cn(TOGGLE, "h-9")} onClick={() => void webQuery.refetch()}>
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> retry
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-h-40 items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
                    </div>
                  )
                ) : (
                  <p className="px-4 py-8 text-center text-body text-taupe">
                    {webQuery.isError ? "Online search failed." : "No online matches for this piece."}
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
                    openPieceSave(id, { layout: "vertical_grid", position })
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
            ) : webQuery.isError ? (
              <button
                type="button"
                className={cn(TOGGLE, "h-9")}
                onClick={() => { setResultsSource("web"); void webQuery.refetch() }}
                disabled={webQuery.isFetching}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> retry
              </button>
            ) : null}
          </div>
        ) : null}

        {/* The tray: web picks go to the Atlyr team, inventory picks go to Studio. */}
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
            <>
              <button
                type="button"
                className={SECONDARY}
                disabled={!selectedWebTotal || addingToAtlyr || openingStudio}
                onClick={() => void addToAtlyr()}
              >
                {addingToAtlyr ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                ) : (
                  <Icons.add className="h-[18px] w-[18px]" aria-hidden="true" />
                )}
                add to atlyr · {selectedWebTotal}
              </button>
              <button
                type="button"
                className={PRIMARY}
                disabled={!selectedInventoryTotal || addingToAtlyr || openingStudio}
                onClick={() => void openInStudio()}
              >
                {openingStudio ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                ) : (
                  <Icons.studio className="h-[18px] w-[18px]" aria-hidden="true" />
                )}
                studio · {selectedInventoryTotal}
              </button>
            </>
          )}
        </div>
      </div>
    </AppShellLayout>
  )
}
