import { useEffect, useLayoutEffect, type RefObject } from "react"

/**
 * Restores and persists a screen's scroll position across navigation.
 *
 * By default this reads and writes the window's scroll position. Pass
 * `containerRef` for a screen that scrolls an internal container instead of
 * the document — the same storage key then tracks that container's
 * `scrollTop` rather than `window.scrollY`.
 */
export function useScrollRestoration(storageKey: string, containerRef?: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const stored = window.sessionStorage.getItem(storageKey)
    const offset = stored ? Number(stored) : 0
    if (Number.isNaN(offset)) {
      return
    }

    const container = containerRef?.current
    if (container) {
      container.scrollTop = offset
    } else {
      window.scrollTo({ top: offset, behavior: "auto" })
    }
  }, [storageKey, containerRef])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const container = containerRef?.current
    if (container) {
      const handleContainerScroll = () => {
        window.sessionStorage.setItem(storageKey, String(container.scrollTop))
      }
      container.addEventListener("scroll", handleContainerScroll, { passive: true })
      return () => {
        handleContainerScroll()
        container.removeEventListener("scroll", handleContainerScroll)
      }
    }

    const handleWindowScroll = () => {
      window.sessionStorage.setItem(storageKey, String(window.scrollY))
    }
    window.addEventListener("scroll", handleWindowScroll, { passive: true })
    return () => {
      handleWindowScroll()
      window.removeEventListener("scroll", handleWindowScroll)
    }
  }, [storageKey, containerRef])
}
