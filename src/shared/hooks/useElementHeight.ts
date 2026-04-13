import { useCallback, useLayoutEffect, useState } from "react"

type ElementHeightHook<T extends HTMLElement> = [(node: T | null) => void, number]

export function useElementHeight<T extends HTMLElement>(): ElementHeightHook<T> {
  const [element, setElement] = useState<T | null>(null)
  const [height, setHeight] = useState(0)

  const attachRef = useCallback((node: T | null) => {
    setElement(node)

    if (!node) {
      setHeight(0)
      return
    }

    const nextHeight = node.getBoundingClientRect().height
    if (nextHeight > 0) {
      setHeight((prev) => (prev !== nextHeight ? nextHeight : prev))
    }
  }, [])

  useLayoutEffect(() => {
    const target = element
    if (!target || typeof ResizeObserver === "undefined") {
      return
    }

    const updateSize = () => {
      const nextHeight = target.getBoundingClientRect().height
      if (nextHeight > 0) {
        setHeight((prev) => (prev !== nextHeight ? nextHeight : prev))
      }
    }

    updateSize()

    const observer = new ResizeObserver((entries) => {
      if (!Array.isArray(entries) || entries.length === 0) {
        updateSize()
        return
      }

      const entry = entries[0]
      const observedHeight = entry.contentRect?.height ?? 0
      if (observedHeight > 0) {
        setHeight((prev) => (prev !== observedHeight ? observedHeight : prev))
      } else {
        updateSize()
      }
    })

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [element])

  return [attachRef, height]
}


