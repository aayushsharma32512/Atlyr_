import { useEffect, useState } from "react"

/**
 * Number of grid columns scaled to the viewport, capped at `max` (default 4).
 * Phone = 2, tablet = 3, desktop = 4. Keeps card width roughly constant so the
 * feed fills a wide screen instead of stranding one narrow column.
 */
export function useResponsiveColumns(max = 4): number {
  const [columns, setColumns] = useState(2)

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth
      const base = width >= 1024 ? 4 : width >= 768 ? 3 : 2
      setColumns(Math.min(base, max))
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [max])

  return columns
}
