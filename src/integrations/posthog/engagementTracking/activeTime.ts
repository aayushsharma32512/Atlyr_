import { useCallback, useRef } from "react"

export function useActiveTimeAccumulator() {
  const accumulatedMsRef = useRef(0)
  const visibleSinceRef = useRef<number | null>(null)

  const reset = useCallback(() => {
    accumulatedMsRef.current = 0
    visibleSinceRef.current = document.visibilityState === "visible" ? Date.now() : null
  }, [])

  const pause = useCallback(() => {
    if (visibleSinceRef.current === null) return
    accumulatedMsRef.current += Date.now() - visibleSinceRef.current
    visibleSinceRef.current = null
  }, [])

  const resume = useCallback(() => {
    if (visibleSinceRef.current !== null) return
    if (document.visibilityState !== "visible") return
    visibleSinceRef.current = Date.now()
  }, [])

  const getActiveDurationMs = useCallback(() => {
    let ms = accumulatedMsRef.current
    if (visibleSinceRef.current !== null && document.visibilityState === "visible") {
      ms += Date.now() - visibleSinceRef.current
    }
    return Math.max(0, Math.floor(ms))
  }, [])

  return { reset, pause, resume, getActiveDurationMs }
}

