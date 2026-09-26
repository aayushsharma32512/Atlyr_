import { useEffect, useState } from "react"

const SLOW_SEARCH_MS = 20_000

/**
 * True once a search has run long enough that a bare spinner reads as broken.
 * The request keeps running; the caller only swaps what it shows.
 */
export function useSlowSearchNotice(isPending: boolean): boolean {
  const [isSlow, setSlow] = useState(false)

  useEffect(() => {
    setSlow(false)
    if (!isPending) return
    const timer = window.setTimeout(() => setSlow(true), SLOW_SEARCH_MS)
    return () => window.clearTimeout(timer)
  }, [isPending])

  return isSlow
}
