import { useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"

import type { FigureCapture } from "@/features/studio/components/PlacementAvatarRenderer"

// One still lives at a time: the next capture frees the last, so hand-offs never leak.
let lastFigureUrl: string | null = null

/**
 * Hands a still of the studio figure to the next screen. `captureRef` goes to
 * the figure; `navigateWithFigure` opens `url` with the still's blob URL in
 * `state.figure`, or with no state while the figure is not drawn yet.
 */
export function useFigureCapture() {
  const navigate = useNavigate()
  const captureRef = useRef<FigureCapture | null>(null)

  const navigateWithFigure = useCallback(
    async (url: string) => {
      const canvas = captureRef.current?.()
      const blob = canvas
        ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85))
        : null
      if (blob) {
        if (lastFigureUrl) URL.revokeObjectURL(lastFigureUrl)
        lastFigureUrl = URL.createObjectURL(blob)
      }
      navigate(url, { state: blob ? { figure: lastFigureUrl } : undefined })
    },
    [navigate],
  )

  return { captureRef, navigateWithFigure }
}
