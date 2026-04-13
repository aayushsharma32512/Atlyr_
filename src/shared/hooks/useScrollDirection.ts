import { useEffect, useRef, useState } from "react"

type ScrollDirection = "up" | "down" | null

interface UseScrollDirectionOptions {
  threshold?: number
  initialDirection?: ScrollDirection
}

/**
 * Hook to track scroll direction within a scrollable container.
 * Returns the current scroll direction: "up", "down", or null.
 */
export function useScrollDirection(
  containerRef: React.RefObject<HTMLElement>,
  options: UseScrollDirectionOptions = {},
): ScrollDirection {
  const { threshold = 5, initialDirection = null } = options
  const [scrollDirection, setScrollDirection] = useState<ScrollDirection>(initialDirection)
  const lastScrollY = useRef(0)
  const ticking = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          const currentScrollY = container.scrollTop

          if (Math.abs(currentScrollY - lastScrollY.current) < threshold) {
            ticking.current = false
            return
          }

          const direction: ScrollDirection = currentScrollY > lastScrollY.current ? "down" : "up"
          setScrollDirection(direction)
          lastScrollY.current = currentScrollY > 0 ? currentScrollY : 0
          ticking.current = false
        })

        ticking.current = true
      }
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [containerRef, threshold])

  return scrollDirection
}

