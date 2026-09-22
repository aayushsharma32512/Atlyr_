import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { useSaveTray } from "@/features/collections/providers/SaveTrayProvider"
import { SourceCrop } from "@/features/inspiration-import/components/CandidatePicker"
import { ImportRack } from "@/features/inspiration-import/components/ImportRack"
import {
  useImportCatalogueResults,
  useImportWebResults,
  useInspirationImport,
} from "@/features/inspiration-import/hooks/useInspirationImport"
import { WARDROBE_TOGGLE } from "@/features/wardrobe-import/components/WardrobeImportChrome"
import { photoProgress } from "@/features/wardrobe-import/photoProgress"
import { useWardrobeBatch } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"
import {
  WARDROBE_PIECE_TYPES,
  type WardrobePhoto,
  type WardrobePieceSelection,
  type WardrobePieceType,
} from "@/features/wardrobe-import/types"
import type {
  InspirationCatalogueResult,
  InspirationWebResult,
} from "@/services/inspirationImport/types"

type Props = {
  photo: WardrobePhoto
  /** True on the last photo of the batch: the forward button hands over to review. */
  isLast: boolean
  canGoBack: boolean
  onPrevious: () => void
  onNext: () => void
  onReview: () => void
}

// The wardrobe rack never locks a listing out: nothing here is sent for ingestion yet.
const NO_ADDED_IDS: ReadonlySet<string> = new Set<string>()

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

/** One photo's matches: a rack per kept piece, one pick each, inventory or web. */
export function WardrobeMatchStep({ photo, isLast, canGoBack, onPrevious, onNext, onReview }: Props) {
  const { setSelection, setPieceSource, setStep } = useWardrobeBatch()
  const { openPieceSave } = useSaveTray()
  const productSaveActions = useProductSaveActions()
  const importQuery = useInspirationImport(photo.importId)
  const record = importQuery.data
  const [openType, setOpenType] = useState<WardrobePieceType | null>(null)

  const candidates = record?.candidates ?? []
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
  const progress = photoProgress(photo)
  const sourceUrl = photo.previewUrl || record?.sourceUrl || ""

  const forward = (
    <button
      type="button"
      onClick={isLast ? onReview : onNext}
      className="flex h-11 flex-1 items-center justify-center gap-2 rounded-control bg-primary text-card font-medium text-primary-foreground"
    >
      {isLast ? "review" : "next photo"}
      <Icons.carouselNext className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  )

  const footer = (
    <>
      <div className="flex-none border-t border-hairline px-4 py-2">
        <p className="flex items-baseline gap-2 text-chip text-ink">
          selected for this photo
          <span className="tabular-nums text-taupe">
            <span className="font-medium text-ink">{progress.selected}</span> of {progress.total}
          </span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {pieces.map((piece) => {
            const picked = Boolean(photo.selections[piece.type])
            return (
              <span
                key={piece.candidate.id}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-badge px-2 text-chip font-medium",
                  picked ? "bg-violet/10 text-violet" : "bg-editorial text-taupe",
                )}
              >
                {picked ? (
                  <Icons.check className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <span className="h-3 w-3 rounded-full border border-current" aria-hidden="true" />
                )}
                {piece.type} {picked ? "selected" : "pending"}
              </span>
            )
          })}
        </div>
      </div>

      <div className="flex h-[76px] flex-none items-center gap-3 border-t border-hairline bg-background px-4 pb-2">
        <button
          type="button"
          disabled={!canGoBack}
          onClick={onPrevious}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-control border border-hairline bg-white text-card font-medium text-ink disabled:opacity-40"
        >
          <Icons.carouselPrev className="h-[18px] w-[18px]" aria-hidden="true" />
          previous photo
        </button>
        {forward}
      </div>
    </>
  )

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
        {footer}
      </div>
    )
  }

  const activeSource = photo.railByPiece[active.candidate.id] ?? "inventory"
  const selection = photo.selections[active.type]
  const catalogueSearch = catalogueSearches.find(
    (search) => search.candidate.id === active.candidate.id,
  )
  const webSearch = webSearches.find((search) => search.candidateId === active.candidate.id)
  const webResults = webSearch?.data ?? []

  const pickInventory = (result: InspirationCatalogueResult) => {
    const clearing = selection?.source === "inventory" && selection.productId === result.id
    setSelection(photo.id, active.type, clearing ? null : inventorySelection(result, active.candidate.id))
  }

  const pickWeb = (result: InspirationWebResult) => {
    const clearing = selection?.source === "web" && selection.listingUrl === result.listingUrl
    setSelection(photo.id, active.type, clearing ? null : webSelection(result, active.candidate.id))
  }

  const selectedWebId = selection?.source === "web"
    ? webResults.find((result) => result.listingUrl === selection.listingUrl)?.providerResultId ?? null
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {backLink}

      {/* Your crop beside the pick standing in for it. */}
      <div className="grid h-[200px] flex-none grid-cols-2 gap-3 px-4 pt-2">
        <div className="overflow-hidden rounded-chip border border-hairline bg-background">
          {sourceUrl ? (
            <SourceCrop sourceUrl={sourceUrl} bbox={active.candidate.bbox} alt={`Your ${active.type}`} />
          ) : null}
        </div>
        {selection ? (
          <div className="overflow-hidden rounded-chip border border-hairline bg-white">
            <img src={selection.imageUrl} alt={selection.title} className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-chip border border-dashed border-hairline px-3 text-center">
            <p className="text-chip text-taupe">tap a match below</p>
          </div>
        )}
      </div>

      <div className="mx-4 mt-2 flex h-9 flex-none items-center justify-between border-b border-hairline">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Piece">
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
                aria-label={type}
                disabled={!piece}
                onClick={() => piece && setOpenType(type)}
                className={cn(
                  "flex h-[26px] w-10 items-center justify-center border-b-2",
                  open ? "border-violet text-ink" : "border-transparent text-ink",
                  !piece && "border-transparent text-disabled",
                )}
              >
                <Glyph className="h-4 w-4" aria-hidden="true" />
              </button>
            )
          })}
        </div>
        <button
          type="button"
          aria-label={activeSource === "web" ? "Show inventory matches" : "Show web matches"}
          onClick={() =>
            setPieceSource(photo.id, active.candidate.id, activeSource === "web" ? "inventory" : "web")
          }
          className={WARDROBE_TOGGLE}
        >
          <Icons.carouselPrev className="h-3.5 w-3.5" aria-hidden="true" />
          {activeSource}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        {activeSource === "web" ? (
          webResults.length ? (
            <ImportRack
              kind="web"
              results={webResults}
              selectedId={selectedWebId}
              addedIds={NO_ADDED_IDS}
              locked={false}
              onSelect={pickWeb}
            />
          ) : webSearch?.isFetching ? (
            <div className="flex min-h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-body text-taupe">
              {webSearch?.isError ? "Online search failed." : "No online matches for this piece."}
            </p>
          )
        ) : catalogueSearch?.isLoading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
          </div>
        ) : (
          <ImportRack
            kind="catalogue"
            results={catalogueSearch?.results ?? []}
            selectedId={selection?.source === "inventory" ? selection.productId ?? null : null}
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

      {footer}
    </div>
  )
}
