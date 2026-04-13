import { useCallback, useEffect, useRef } from "react"

let viewportLockCount = 0
let originalViewportContent: string | null = null

function getViewportMeta(): HTMLMetaElement | null {
  if (typeof document === "undefined") {
    return null
  }
  return document.querySelector('meta[name="viewport"]')
}

function buildLockedViewportContent(content: string) {
  const entries = content
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)

  const hasMaxScale = entries.some((entry) => entry.startsWith("maximum-scale"))
  const hasUserScalable = entries.some((entry) => entry.startsWith("user-scalable"))

  if (!hasMaxScale) {
    entries.push("maximum-scale=1")
  }
  if (!hasUserScalable) {
    entries.push("user-scalable=no")
  }

  return entries.join(", ")
}

function lockViewportZoom() {
  const meta = getViewportMeta()
  if (!meta) {
    return
  }
  if (viewportLockCount === 0) {
    originalViewportContent = meta.content || ""
    meta.content = buildLockedViewportContent(meta.content || "")
  }
  viewportLockCount += 1
}

function unlockViewportZoom() {
  const meta = getViewportMeta()
  if (!meta || viewportLockCount === 0) {
    return
  }
  viewportLockCount = Math.max(0, viewportLockCount - 1)
  if (viewportLockCount === 0 && originalViewportContent !== null) {
    meta.content = originalViewportContent
  }
}

export function useViewportZoomLockController() {
  const lockedRef = useRef(false)

  const lock = useCallback(() => {
    if (lockedRef.current) return
    lockViewportZoom()
    lockedRef.current = true
  }, [])

  const unlock = useCallback(() => {
    if (!lockedRef.current) return
    unlockViewportZoom()
    lockedRef.current = false
  }, [])

  useEffect(() => {
    return () => {
      if (lockedRef.current) {
        unlockViewportZoom()
        lockedRef.current = false
      }
    }
  }, [])

  return { lock, unlock }
}
