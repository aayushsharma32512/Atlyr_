import { useCallback, useMemo, useRef } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { isCanvasSlot, type StudioCanvasSlot } from "@/features/studio/constants/layering"

/**
 * Studio focus zoom, held in `?focus=`. Entering pushes a history entry so the
 * back gesture exits focus instead of leaving Studio; stepping between slots
 * replaces, so a swipe does not stack entries.
 */
export function useStudioFocus() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  /** True once we pushed a focus entry — a deep link arrives without one. */
  const pushedRef = useRef(false)

  const focus = useMemo(() => {
    const raw = searchParams.get("focus")
    return isCanvasSlot(raw) ? raw : null
  }, [searchParams])

  const write = useCallback(
    (slot: StudioCanvasSlot | null, replace: boolean) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (slot) {
            next.set("focus", slot)
          } else {
            next.delete("focus")
          }
          return next
        },
        { replace },
      )
    },
    [setSearchParams],
  )

  const openFocus = useCallback(
    (slot: StudioCanvasSlot) => {
      if (focus) {
        write(slot, true)
        return
      }
      pushedRef.current = true
      write(slot, false)
    },
    [focus, write],
  )

  const closeFocus = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false
      navigate(-1)
      return
    }
    write(null, true)
  }, [navigate, write])

  // Stepping lives in StudioScreen: it has to skip slots with nothing worn,
  // which needs the tray. `openFocus` replaces while focused, so it steps.
  return { focus, openFocus, closeFocus }
}
