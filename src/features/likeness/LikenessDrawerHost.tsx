import { useCallback, useEffect, useState } from "react"

import { LikenessDrawer } from "./LikenessDrawer"
import type {
  LikenessDrawerOpenDetail,
  LikenessOutfitItemsParam,
  LikenessOutfitSnapshotParam,
  LikenessStep,
} from "./types"

export function LikenessDrawerHost() {
  const [open, setOpen] = useState(false)
  const [initialStep, setInitialStep] = useState<LikenessStep | undefined>()
  const [initialBatchId, setInitialBatchId] = useState<string | null>(null)
  const [outfitItems, setOutfitItems] = useState<LikenessOutfitItemsParam | undefined>()
  const [outfitSnapshot, setOutfitSnapshot] = useState<LikenessOutfitSnapshotParam | undefined>()
  const [entrySource, setEntrySource] = useState<"direct" | "fromProgressHub" | "fromStep3">("direct")
  const [initialSavedMode, setInitialSavedMode] = useState(false)
  const [initialSavedPoseId, setInitialSavedPoseId] = useState<string | null>(null)

  const handleOpen = useCallback((detail?: LikenessDrawerOpenDetail) => {
    setInitialStep(detail?.initialStep)
    setInitialBatchId(detail?.batchId ?? null)
    setOutfitItems(detail?.outfitItems)
    setOutfitSnapshot(detail?.outfitSnapshot)
    setEntrySource(detail?.entrySource ?? "direct")
    setInitialSavedMode(Boolean(detail?.savedMode))
    setInitialSavedPoseId(detail?.savedPoseId ?? null)
    setOpen(true)
  }, [])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setInitialStep(undefined)
      setInitialBatchId(null)
      setOutfitItems(undefined)
      setOutfitSnapshot(undefined)
      setEntrySource("direct")
      setInitialSavedMode(false)
      setInitialSavedPoseId(null)
    }
  }, [])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const customEvent = event as CustomEvent<LikenessDrawerOpenDetail>
      handleOpen(customEvent.detail)
    }
    window.addEventListener("openLikenessDrawer", onOpen as EventListener)
    return () => {
      window.removeEventListener("openLikenessDrawer", onOpen as EventListener)
    }
  }, [handleOpen])

  return (
    <LikenessDrawer
      open={open}
      onOpenChange={handleOpenChange}
      initialStep={initialStep}
      initialBatchId={initialBatchId}
      outfitItems={outfitItems}
      outfitSnapshot={outfitSnapshot}
      entrySource={entrySource}
      initialSavedMode={initialSavedMode}
      initialSavedPoseId={initialSavedPoseId}
    />
  )
}


