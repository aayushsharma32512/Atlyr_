import { useEffect, useState } from "react"

/**
 * Bottom offset for a fixed dock so it rides above the soft keyboard.
 * Fixed elements sit on the layout viewport; the keyboard shrinks the visual one.
 */
export function useDockAboveKeyboard(navHeight: number): number {
  const [bottom, setBottom] = useState(navHeight)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      // With the keyboard up the nav is under it, so the dock sits on the keyboard edge.
      setBottom(covered > 0 ? covered : navHeight)
    }
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [navHeight])

  return bottom
}
