import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { boardPath } from "@/features/collections/boardUrl"
import { useSaveProductToCollection } from "@/features/collections/hooks/useMoodboards"
import { inspirationImportKeys } from "@/features/inspiration-import/queryKeys"
import { useWardrobeBatch } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"
import { useToast } from "@/hooks/use-toast"
import { inspirationImportService } from "@/services/inspirationImport/inspirationImportService"

export type WardrobeWebCommit = {
  importId: string
  candidateId: string
  selectionToken: string
}

export type WardrobeCommitInput = {
  /** Inventory products that are not on the board yet. */
  productIds: string[]
  webSelections: WardrobeWebCommit[]
}

const WARDROBE_BOARD_PATH = boardPath("wardrobe")

/**
 * Sends the reviewed batch: inventory picks go straight onto the wardrobe board,
 * web picks go to the team for ingestion, one call per photo they came from.
 */
export function useCommitWardrobeBatch() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const saveProduct = useSaveProductToCollection()
  const { reset } = useWardrobeBatch()
  const { toast } = useToast()

  return useMutation({
    mutationFn: async ({ productIds, webSelections }: WardrobeCommitInput) => {
      const byImport = new Map<string, Array<{ candidateId: string; selectionToken: string }>>()
      for (const pick of webSelections) {
        const group = byImport.get(pick.importId) ?? []
        group.push({ candidateId: pick.candidateId, selectionToken: pick.selectionToken })
        byImport.set(pick.importId, group)
      }

      const results = await Promise.allSettled([
        ...productIds.map((productId) =>
          saveProduct.mutateAsync({ productId, slug: "wardrobe", label: "Wardrobe" })),
        ...[...byImport].map(async ([importId, selections]) => {
          await inspirationImportService.addWebSelections(importId, { selections })
          await queryClient.invalidateQueries({ queryKey: inspirationImportKeys.detail(importId) })
        }),
      ])
      if (results.some((result) => result.status === "rejected")) throw new Error("commit_failed")

      return { added: productIds.length, queued: webSelections.length }
    },
    onSuccess: ({ added, queued }) => {
      const parts = [
        ...(added ? [`${added} added`] : []),
        ...(queued ? [`${queued} on their way`] : []),
      ]
      toast({ title: parts.join(", ") })
      reset()
      navigate(WARDROBE_BOARD_PATH)
    },
    onError: () => {
      toast({
        title: "Could not add everything",
        description: "Your picks are still here — try again.",
        variant: "destructive",
      })
    },
  })
}
