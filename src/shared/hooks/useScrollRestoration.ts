import { useEffect, useLayoutEffect } from "react"

export function useScrollRestoration(storageKey: string) {
  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const stored = window.sessionStorage.getItem(storageKey)
    const offset = stored ? Number(stored) : 0
    if (!Number.isNaN(offset)) {
      window.scrollTo({ top: offset, behavior: "auto" })
    }
  }, [storageKey])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const handleScroll = () => {
      window.sessionStorage.setItem(storageKey, String(window.scrollY))
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      handleScroll()
      window.removeEventListener("scroll", handleScroll)
    }
  }, [storageKey])
}


