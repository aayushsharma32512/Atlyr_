import { useCallback, useLayoutEffect, useState } from "react"

export type ElementSize = { width: number; height: number }

type ElementSizeHook<T extends HTMLElement> = [(node: T | null) => void, ElementSize]

const ZERO: ElementSize = { width: 0, height: 0 }

/**
 * Both dimensions of an element, tracked through resize.
 *
 * Sibling of useElementHeight rather than a generalisation of it: that hook has
 * three callers across home and studio, and widening its return type to serve
 * this one would edit surfaces this change has no business touching.
 *
 * Exists for PlacementAvatarRenderer, which is a PIXI surface and takes numeric
 * containerWidth/containerHeight — it cannot be sized by CSS, so whatever hosts
 * it has to be measured.
 */
export function useElementSize<T extends HTMLElement>(): ElementSizeHook<T> {
  const [element, setElement] = useState<T | null>(null)
  const [size, setSize] = useState<ElementSize>(ZERO)

  // Only ever swap in a new object when a dimension actually moved. The size
  // feeds a renderer that rebuilds its scene on prop change, so returning a
  // fresh {width, height} every observer tick would thrash it.
  const commit = useCallback((width: number, height: number) => {
    if (width <= 0 || height <= 0) return
    setSize((prev) => (prev.width !== width || prev.height !== height ? { width, height } : prev))
  }, [])

  const attachRef = useCallback(
    (node: T | null) => {
      setElement(node)

      if (!node) {
        setSize(ZERO)
        return
      }

      const rect = node.getBoundingClientRect()
      commit(rect.width, rect.height)
    },
    [commit],
  )

  useLayoutEffect(() => {
    const target = element
    if (!target || typeof ResizeObserver === "undefined") {
      return
    }

    const measure = () => {
      const rect = target.getBoundingClientRect()
      commit(rect.width, rect.height)
    }

    measure()

    const observer = new ResizeObserver((entries) => {
      const rect = Array.isArray(entries) ? entries[0]?.contentRect : undefined
      if (rect && rect.width > 0 && rect.height > 0) {
        commit(rect.width, rect.height)
      } else {
        measure()
      }
    })

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [commit, element])

  return [attachRef, size]
}
