import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import { useSaveProductToCollection } from "@/features/collections/hooks/useMoodboards"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { useSaveTray } from "@/features/collections/providers/SaveTrayProvider"
import { SourceCrop } from "@/features/inspiration-import/components/CandidatePicker"
import { ImportMannequinPreview } from "@/features/inspiration-import/components/ImportMannequinPreview"
import { ImportRack } from "@/features/inspiration-import/components/ImportRack"
import {
  useAddImportWebSelections,
  useImportCatalogueResults,
  useImportWebResults,
  useInspirationImport,
} from "@/features/inspiration-import/hooks/useInspirationImport"
import { useSlowSearchNotice } from "@/features/inspiration-import/hooks/useSlowSearchNotice"
import {
  WARDROBE_PRIMARY,
  WARDROBE_SECONDARY,
  WARDROBE_TOGGLE,
} from "@/features/wardrobe-import/components/WardrobeImportChrome"
import { useWardrobeBatch } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"
import {
  WARDROBE_PIECE_TYPES,
  type WardrobePhoto,
  type WardrobePieceRef,
  type WardrobePieceSelection,
  type WardrobePieceType,
  type WardrobeRailSource,
} from "@/features/wardrobe-import/types"
import { useToast } from "@/hooks/use-toast"
import type {
  InspirationCatalogueResult,
  InspirationCategory,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

type Props = {
  photo: WardrobePhoto
  /** Says which picks of this photo have just been sent on. */
  onCommitted: (photoId: string, picks: WardrobePieceRef[]) => void
}

// Shared empty arrays, so a rack that has not answered yet does not hand the
// mannequin a new array on every render.
const NO_CATALOGUE_RESULTS: InspirationCatalogueResult[] = []
const NO_WEB_RESULTS: InspirationWebResult[] = []

function inventorySelection(
  result: InspirationCatalogueResult,
  candidateId: string,
): WardrobePieceSelection {
  return {
    source: "inventory",
    productId: result.id,
    title: result.title,
    imageUrl: result.thumbnailSrc || result.imageSrc,
    brand: result.brand,
    priceLabel: result.priceLabel,
    candidateId,
  }
}

function webSelection(result: InspirationWebResult, candidateId: string): WardrobePieceSelection {
  return {
    source: "web",
    listingUrl: result.listingUrl,
    title: result.title,
    imageUrl: result.imageUrl,
    brand: result.merchantDomain,
    priceLabel: result.priceLabel ?? undefined,
    selectionToken: result.selectionToken ?? undefined,
    candidateId,
  }
}

/** The inventory row behind an inventory pick, which is what the mannequin wears. */
function pickedInventory(
  selection: WardrobePieceSelection | undefined,
  results: InspirationCatalogueResult[],
): InspirationCatalogueResult | null {
  if (selection?.source !== "inventory" || !selection.productId) return null
  return results.find((result) => result.id === selection.productId) ?? null
}

/** One photo's matches: the figure wearing the picks, a rack per kept piece, one pick each. */
export function WardrobeMatchStep({ photo, onCommitted }: Props) {
  const { setSelection, setPieceSource, setStep } = useWardrobeBatch()
  const { openPieceSave } = useSaveTray()
  const productSaveActions = useProductSaveActions()
  const { toast } = useToast()
  const importQuery = useInspirationImport(photo.importId)
  const record = importQuery.data
  const saveProduct = useSaveProductToCollection()
  const addWebSelections = useAddImportWebSelections(photo.importId ?? "")
  const [openType, setOpenType] = useState<WardrobePieceType | null>(null)

  const candidates = record?.candidates ?? []
  // The same image the pieces step draws the boxes on, so a crop of a box lines up with it.
  const sourceImageUrl = photo.previewUrl || record?.sourceUrl || ""
  const pieces = WARDROBE_PIECE_TYPES.flatMap((type) => {
    const candidate = candidates.find(
      (item) => item.category === type && photo.confirmedPieceIds.includes(item.id),
    )
    return candidate ? [{ type, candidate }] : []
  })

  // Both racks of every kept piece are fetched at once, so a tab switch never waits on a search.
  const catalogueSearches = useImportCatalogueResults(record, photo.confirmedPieceIds)
  const webSearches = useImportWebResults(
    photo.importId ?? "",
    pieces.map((piece) => ({ id: piece.candidate.id })),
  )

  const active = pieces.find((piece) => piece.type === openType) ?? pieces[0] ?? null
  const activeCandidateId = active?.candidate.id ?? null
  const activePicks = active ? photo.selections[active.type] : undefined
  const inventoryPick = activePicks?.inventory
  const webPick = activePicks?.web

  const catalogueResultsOf = (pieceType: WardrobePieceType) => {
    const candidateId = pieces.find((piece) => piece.type === pieceType)?.candidate.id
    const results = candidateId
      ? catalogueSearches.find((search) => search.candidate.id === candidateId)?.results
      : undefined
    return results?.length ? results : NO_CATALOGUE_RESULTS
  }
  const topResults = catalogueResultsOf("top")
  const bottomResults = catalogueResultsOf("bottom")
  const topSelection = photo.selections.top?.inventory
  const bottomSelection = photo.selections.bottom?.inventory
  const inventoryChoices = useMemo<Partial<Record<InspirationCategory, InspirationCatalogueResult | null>>>(
    () => ({
      top: pickedInventory(topSelection, topResults),
      bottom: pickedInventory(bottomSelection, bottomResults),
    }),
    [bottomResults, bottomSelection, topResults, topSelection],
  )

  const catalogueSearch = catalogueSearches.find(
    (search) => search.candidate.id === activeCandidateId,
  )
  const webSearch = webSearches.find((search) => search.candidateId === activeCandidateId)
  const webSearchIsSlow = useSlowSearchNotice(Boolean(webSearch?.isFetching))
  const webData = webSearch?.data
  // Listings already sent to the Atlyr team, so a committed pick stays on the rack it came from.
  const persistedWeb = record?.webResults
  const webResults = useMemo(() => {
    if (!activeCandidateId) return NO_WEB_RESULTS
    const resultsByProviderId = new Map<string, InspirationWebResult>()
    for (const result of persistedWeb ?? []) {
      if (result.candidateId === activeCandidateId) resultsByProviderId.set(result.providerResultId, result)
    }
    for (const result of webData ?? []) resultsByProviderId.set(result.providerResultId, result)
    return [...resultsByProviderId.values()].sort((left, right) => left.rank - right.rank)
  }, [activeCandidateId, persistedWeb, webData])
  const addedWebIds = useMemo(
    () => new Set((persistedWeb ?? []).map((result) => result.providerResultId)),
    [persistedWeb],
  )
  const addedCandidateIds = useMemo(
    () => new Set((persistedWeb ?? []).map((result) => result.candidateId)),
    [persistedWeb],
  )

  const pendingPicks = (source: WardrobeRailSource): WardrobePieceRef[] => pieces.flatMap((piece) => {
    const pick = photo.selections[piece.type]?.[source]
    return pick && !pick.committedAt ? [{ type: piece.type, source }] : []
  })
  const pendingInventory = pendingPicks("inventory")
  const pendingWeb = pendingPicks("web")
  const committing = saveProduct.isPending || addWebSelections.isPending

  const addToWardrobe = async () => {
    if (!pendingInventory.length) return
    try {
      for (const { type } of pendingInventory) {
        const productId = photo.selections[type]?.inventory?.productId
        if (productId) await saveProduct.mutateAsync({ productId, slug: "wardrobe", label: "Wardrobe" })
      }
    } catch {
      toast({
        title: "Could not add to your wardrobe",
        description: "Your picks are still here — try again.",
        variant: "destructive",
      })
      return
    }
    toast({ title: "Added to your wardrobe" })
    onCommitted(photo.id, pendingInventory)
  }

  const addToAtlyr = async () => {
    if (!pendingWeb.length || !photo.importId) return
    const selections = pendingWeb.flatMap(({ type }) => {
      const pick = photo.selections[type]?.web
      return pick?.selectionToken
        ? [{ candidateId: pick.candidateId, selectionToken: pick.selectionToken }]
        : []
    })
    if (selections.length !== pendingWeb.length) {
      toast({
        title: "An online pick expired",
        description: "Search online again and reselect it.",
        variant: "destructive",
      })
      return
    }
    try {
      await addWebSelections.mutateAsync({ selections })
    } catch {
      toast({
        title: "Could not send your online picks",
        description: "Your picks are still here — try again.",
        variant: "destructive",
      })
      return
    }
    toast({ title: "Added to Atlyr", description: "The Atlyr team will review and add it to Atlyr's inventory." })
    onCommitted(photo.id, pendingWeb)
  }

  const backLink = (
    <div className="flex-none px-4 pt-2">
      <button
        type="button"
        onClick={() => setStep(photo.id, "pieces")}
        className="inline-flex items-center gap-1.5 text-body text-ink"
      >
        <Icons.carouselPrev className="h-4 w-4" aria-hidden="true" />
        back to pieces
      </button>
    </div>
  )

  // The tray: web picks go to the Atlyr team, inventory picks go to the wardrobe board.
  const tray = (
    <div className="flex h-[76px] flex-none items-center gap-3 border-t border-hairline bg-background px-4 pb-2">
      <button
        type="button"
        className={WARDROBE_SECONDARY}
        disabled={!pendingWeb.length || committing}
        onClick={() => void addToAtlyr()}
      >
        {addWebSelections.isPending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <Icons.add className="h-[18px] w-[18px]" aria-hidden="true" />
        )}
        add to atlyr · {pendingWeb.length}
      </button>
      <button
        type="button"
        className={WARDROBE_PRIMARY}
        disabled={!pendingInventory.length || committing}
        onClick={() => void addToWardrobe()}
      >
        {saveProduct.isPending ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
        ) : (
          <Icons.sourceWardrobe className="h-[18px] w-[18px]" aria-hidden="true" />
        )}
        add to wardrobe · {pendingInventory.length}
      </button>
    </div>
  )

  if (!active) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {backLink}
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
          {importQuery.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
          ) : (
            <p className="text-body text-taupe">No pieces kept from this photo.</p>
          )}
        </div>
        {tray}
      </div>
    )
  }

  const activeSource = photo.railByPiece[active.candidate.id] ?? "inventory"
  // Each rail locks on its own pick: sending the online pick must not freeze the inventory rack.
  const inventoryLocked = Boolean(inventoryPick?.committedAt)
  const webLocked = Boolean(webPick?.committedAt)
  const activeWebChoice = webPick
    ? webResults.find((result) => result.listingUrl === webPick.listingUrl) ?? null
    : null
  const selectedWebId = activeWebChoice?.providerResultId ?? null
  // A pick that has just been sent reads as added before its row comes back.
  const webAddedIds = webLocked && selectedWebId && !addedWebIds.has(selectedWebId)
    ? new Set([...addedWebIds, selectedWebId])
    : addedWebIds

  const pickInventory = (result: InspirationCatalogueResult) => {
    if (inventoryLocked) return
    const clearing = inventoryPick?.productId === result.id
    setSelection(photo.id, active.type, "inventory", clearing ? null : inventorySelection(result, active.candidate.id))
  }

  const pickWeb = (result: InspirationWebResult) => {
    if (webLocked || addedCandidateIds.has(active.candidate.id) || addedWebIds.has(result.providerResultId)) return
    const clearing = webPick?.listingUrl === result.listingUrl
    setSelection(photo.id, active.type, "web", clearing ? null : webSelection(result, active.candidate.id))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {backLink}

      {/* Your crop beside the figure wearing the pick, as on the import screen. */}
      <div className="grid h-[272px] flex-none grid-cols-2 gap-3 px-4 pt-3">
        <div className="relative overflow-hidden rounded-chip bg-background">
          {sourceImageUrl ? (
            <SourceCrop sourceUrl={sourceImageUrl} bbox={active.candidate.bbox} alt="Your pick" />
          ) : null}
        </div>
        <ImportMannequinPreview
          inventoryChoices={inventoryChoices}
          activeCategory={active.type}
          activeWebChoice={activeWebChoice}
          resultsSource={activeSource}
        />
      </div>

      {/* Slot tabs, violet underline; kicks is not detected, so it reads dimmed. The
          source toggle sits on the right and flips with a chevron. */}
      <div className="mx-4 flex h-9 flex-none items-center justify-between border-b border-hairline">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Slot">
          {WARDROBE_PIECE_TYPES.map((type) => {
            const piece = pieces.find((item) => item.type === type)
            const open = piece?.type === active.type
            const Glyph = type === "top" ? Icons.slotTop : Icons.slotBottom
            return (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={open}
                aria-label={type === "top" ? "tops" : "lowers"}
                disabled={!piece}
                onClick={() => piece && setOpenType(type)}
                className={cn(
                  "flex h-[26px] w-10 items-center justify-center border-b-2",
                  open ? "border-violet text-ink" : "border-transparent text-ink",
                  !piece && "text-taupe",
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
        {activeSource === "web" ? (
          <button
            type="button"
            onClick={() => setPieceSource(photo.id, active.candidate.id, "inventory")}
            className={WARDROBE_TOGGLE}
          >
            inventory
            <Icons.carouselNext className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPieceSource(photo.id, active.candidate.id, "web")}
            className={WARDROBE_TOGGLE}
          >
            <Icons.carouselPrev className="h-3.5 w-3.5" aria-hidden="true" />
            web search
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        {activeSource === "web" ? (
          webResults.length ? (
            <ImportRack
              kind="web"
              results={webResults}
              selectedId={selectedWebId}
              addedIds={webAddedIds}
              locked={webLocked || addedCandidateIds.has(active.candidate.id)}
              onSelect={pickWeb}
            />
          ) : webSearch?.isFetching ? (
            webSearchIsSlow ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center">
                <p className="text-body text-taupe">Web search is taking longer than expected</p>
                <button type="button" className={WARDROBE_TOGGLE} onClick={() => void webSearch?.refetch()}>
                  retry
                </button>
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
              </div>
            )
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              <p className="text-body text-taupe">
                {webSearch?.isError ? "Online search failed." : "No online matches for this piece."}
              </p>
              {webSearch?.isError ? (
                <button type="button" className={WARDROBE_TOGGLE} onClick={() => void webSearch.refetch()}>
                  retry
                </button>
              ) : null}
            </div>
          )
        ) : catalogueSearch?.isLoading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
          </div>
        ) : (
          <ImportRack
            kind="catalogue"
            results={catalogueSearch?.results ?? NO_CATALOGUE_RESULTS}
            selectedId={inventoryPick?.productId ?? null}
            isFavorite={productSaveActions.isSaved}
            isSaving={productSaveActions.isSaving}
            markSelected
            onSelect={pickInventory}
            onToggleFavorite={(id, _nextSaved, position) =>
              openPieceSave(id, { layout: "vertical_grid", position })
            }
          />
        )}
      </div>

      {tray}
    </div>
  )
}
