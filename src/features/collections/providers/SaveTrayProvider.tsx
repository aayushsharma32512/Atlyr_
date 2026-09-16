import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import { useAuth } from "@/contexts/AuthContext"
import {
  useCollectionsOverview,
  useCreateMoodboard,
  useOutfitCollectionMembership,
  useRemoveFromCollection,
  useSaveToCollection,
} from "@/features/collections/hooks/useMoodboards"
import { useProductSaveActions } from "@/features/collections/hooks/useProductSaveActions"
import { useUpdateOutfit } from "@/features/outfits/hooks/useUpdateOutfit"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { StudioSaveCard } from "@/features/studio/components/StudioSaveCard"
import { useStudioOutfit } from "@/features/studio/hooks/useStudioOutfit"
import { useToast } from "@/hooks/use-toast"
import type { EntityUiContext } from "@/integrations/posthog/engagementTracking/entityEvents"
import { getOutfitChips } from "@/utils/outfitChips"

type SaveRequest =
  | { kind: "look"; outfitId: string; context?: EntityUiContext; presetBoardSlug?: string }
  | { kind: "piece"; productId: string; context?: EntityUiContext; presetBoardSlug?: string }

interface SaveTrayValue {
  isOpen: boolean
  /**
   * `presetBoardSlug`: when opened from a specific board's own page, that
   * board should be the default checked chip for an item with no saves yet
   * — not the app-wide "favorites" fallback. Ignored once the item already
   * has real memberships; those are always the authoritative default.
   */
  openLookSave: (outfitId: string, context?: EntityUiContext, presetBoardSlug?: string) => void
  openPieceSave: (productId: string, context?: EntityUiContext, presetBoardSlug?: string) => void
  close: () => void
}

const noop = () => {}
const SaveTrayContext = createContext<SaveTrayValue>({ isOpen: false, openLookSave: noop, openPieceSave: noop, close: noop })

export function useSaveTray() {
  return useContext(SaveTrayContext)
}

/**
 * The save tray, app-wide. Every heart on a card opens Studio's save card in a
 * bottom sheet — same card, same boards — and the tab bar drops while it is up
 * (AppShellLayout reads `isOpen`). Studio and Alternates keep their in-band card.
 *
 * The provider itself holds only the request. Everything that fetches lives in
 * the sheet below, which mounts when a heart is tapped: this wraps the whole app,
 * so running the collections queries here would fire them on every page load —
 * and, before these queries keyed on the user, that raced auth and cached the
 * signed-out fallback over the real boards.
 */
export function SaveTrayProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<SaveRequest | null>(null)

  const openLookSave = useCallback((outfitId: string, context?: EntityUiContext, presetBoardSlug?: string) => {
    setRequest({ kind: "look", outfitId, context, presetBoardSlug })
  }, [])
  const openPieceSave = useCallback((productId: string, context?: EntityUiContext, presetBoardSlug?: string) => {
    setRequest({ kind: "piece", productId, context, presetBoardSlug })
  }, [])
  const close = useCallback(() => setRequest(null), [])

  const value = useMemo<SaveTrayValue>(
    () => ({ isOpen: request !== null, openLookSave, openPieceSave, close }),
    [close, openLookSave, openPieceSave, request],
  )

  return (
    <SaveTrayContext.Provider value={value}>
      {children}
      <Drawer open={request !== null} onOpenChange={(open) => { if (!open) close() }}>
        {/* Studio's column width, so the card and its buttons match the studio card. */}
        <DrawerContent className="mx-auto w-full max-w-sm">
          <DrawerTitle className="sr-only">Save</DrawerTitle>
          <DrawerDescription className="sr-only">Pick the boards this goes to.</DrawerDescription>
          {request ? <SaveTraySheet request={request} onClose={close} /> : null}
        </DrawerContent>
      </Drawer>
    </SaveTrayContext.Provider>
  )
}

/**
 * A piece saves to boards. A look saves to boards too; when it is the user's own
 * look the name and tag rows show and persist as well, as they do on Studio. A
 * look someone else made cannot be renamed, so those rows stay hidden for it.
 */
function SaveTraySheet({ request, onClose }: { request: SaveRequest; onClose: () => void }) {
  const [isSaving, setIsSaving] = useState(false)
  const { user } = useAuth()
  const { profile } = useProfileContext()
  const { toast } = useToast()
  const overviewQuery = useCollectionsOverview()
  const createMoodboardMutation = useCreateMoodboard()
  const productSaveActions = useProductSaveActions()
  const membershipQuery = useOutfitCollectionMembership()
  const saveToCollection = useSaveToCollection()
  const removeFromCollection = useRemoveFromCollection()
  const updateOutfit = useUpdateOutfit()
  const outfitQuery = useStudioOutfit(request.kind === "look" ? request.outfitId : null)

  const moodboards = useMemo(() => overviewQuery.data?.moodboards ?? [], [overviewQuery.data?.moodboards])
  const lookBoards = useMemo(
    () => moodboards.filter((m) => !m.isSystem || m.slug === "favorites").map(({ slug, label }) => ({ slug, label })),
    [moodboards],
  )
  // Wardrobe leads the piece row (the piece variant of the card), then the rest.
  const pieceBoards = useMemo(() => {
    const wardrobe = moodboards.find((m) => m.slug === "wardrobe")
    return wardrobe ? [{ slug: wardrobe.slug, label: wardrobe.label }, ...lookBoards] : lookBoards
  }, [lookBoards, moodboards])

  const outfit = request.kind === "look" ? (outfitQuery.data?.outfit ?? null) : null
  const ownsLook = Boolean(outfit && user?.id && outfit.user_id === user.id)
  const lookSlugs = useMemo(() => {
    if (request.kind !== "look") return []
    const membership = membershipQuery.data ?? {}
    return lookBoards.map((board) => board.slug).filter((slug) => membership[slug]?.has(request.outfitId))
  }, [lookBoards, membershipQuery.data, request])
  const pieceSlugs = request.kind === "piece" ? productSaveActions.getProductBoardSlugs(request.productId) : []

  const handleSave = async (data: { name: string; tags: string[]; boardSlugs: string[] }) => {
    if (request.kind === "piece") {
      try {
        await productSaveActions.onSaveToBoards(request.productId, data.boardSlugs, request.context)
      } catch {
        // onSaveToBoards has already toasted; keep the card open to retry.
        return
      }
      toast({ title: data.boardSlugs.length ? "Saved" : "Removed from boards" })
      onClose()
      return
    }
    setIsSaving(true)
    try {
      const labelBySlug = new Map(lookBoards.map((board) => [board.slug, board.label] as const))
      const current = new Set(lookSlugs)
      const next = new Set(data.boardSlugs)
      for (const slug of data.boardSlugs.filter((slug) => !current.has(slug))) {
        await saveToCollection.mutateAsync({
          outfitId: request.outfitId, slug, label: labelBySlug.get(slug), entityTitle: outfit?.name,
        })
      }
      for (const slug of lookSlugs.filter((slug) => !next.has(slug))) {
        await removeFromCollection.mutateAsync({ outfitId: request.outfitId, slug })
      }
      if (ownsLook && outfit && user?.id) {
        await updateOutfit.mutateAsync({
          outfitId: outfit.id,
          userId: user.id,
          name: data.name.trim() || outfit.name,
          categoryId: outfit.category,
          occasionId: outfit.occasion?.id ?? "",
          backgroundId: outfit.backgroundId ?? null,
          isPrivate: false,
          vibe: outfit.vibes ?? null,
          keywords: data.tags.join(", "),
          createdByName: profile?.name ?? null,
        })
      }
      toast({ title: data.boardSlugs.length ? "Saved" : "Removed from boards" })
      onClose()
    } catch (error) {
      toast({
        title: "Could not save",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  // The card holds its own draft, so it remounts when the look and its
  // memberships finish loading rather than keeping the stale defaults.
  const cardKey =
    request.kind === "look"
      ? `look:${request.outfitId}:${outfit?.id ?? ""}:${lookSlugs.join("|")}`
      : `piece:${request.productId}:${pieceSlugs.join("|")}`

  // Real memberships always win; the preset only fills in for an item that
  // has never been saved anywhere, so it doesn't default to Favorites when
  // the user clearly meant "this board" by opening the card from it.
  const lookDefaultSlugs = lookSlugs.length ? lookSlugs : request.presetBoardSlug ? [request.presetBoardSlug] : ["favorites"]
  const pieceDefaultSlugs = pieceSlugs.length ? pieceSlugs : request.presetBoardSlug ? [request.presetBoardSlug] : ["favorites"]

  return (
    <div className="px-4 pb-6 pt-4">
      <StudioSaveCard
        key={cardKey}
        kind={request.kind}
        defaultName={request.kind === "look" && ownsLook ? (outfit?.name ?? "") : undefined}
        defaultTags={request.kind === "look" && ownsLook ? getOutfitChips(outfit) : []}
        boards={request.kind === "look" ? lookBoards : pieceBoards}
        defaultBoardSlugs={request.kind === "look" ? lookDefaultSlugs : pieceDefaultSlugs}
        isSaving={isSaving || productSaveActions.isSaving}
        onSave={(data) => void handleSave(data)}
        onCancel={onClose}
        onCreateBoard={(name) => createMoodboardMutation.mutateAsync(name).then((res) => res.slug)}
      />
    </div>
  )
}
