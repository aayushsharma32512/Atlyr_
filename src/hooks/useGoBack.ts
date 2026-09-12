import { useCallback } from "react"
import { useNavigate } from "react-router-dom"

/**
 * The index this app keeps in the browser's history state. Above zero means we
 * pushed an entry behind this one and popping stays inside the app.
 *
 * Unlike `location.key`, it survives replace navigations — Studio rewrites its
 * URL constantly — so it still reads 0 after a share link or a refresh.
 */
export function hasAppHistory(): boolean {
  if (typeof window === "undefined") return false
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === "number" && idx > 0
}

/** Back that always goes somewhere: pop when we can, else replace with `fallback`. */
export function useGoBack(fallback: string) {
  const navigate = useNavigate()
  return useCallback(() => {
    if (hasAppHistory()) {
      navigate(-1)
      return
    }
    navigate(fallback, { replace: true })
  }, [fallback, navigate])
}
