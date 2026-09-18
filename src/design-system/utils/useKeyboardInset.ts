import { useEffect, useState } from "react"

/**
 * How far the soft keyboard reaches into the layout viewport; 0 while closed.
 * It is non-zero only where the keyboard shrinks the visual viewport alone
 * (Safari on iOS). Where it shrinks the layout viewport too, a fixed bottom
 * already clears it. For screens whose document does not scroll: while the
 * keyboard is up the page is held at scroll 0, so Safari cannot slide the
 * header away to reveal the field.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      if (covered > 0 && (vv.offsetTop > 0 || window.scrollY > 0)) window.scrollTo(0, 0)
      setInset(covered)
    }
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [])

  return inset
}
