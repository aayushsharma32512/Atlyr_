import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * True below `breakpoint`. The argument defaults to the original 768 so every
 * existing caller keeps its exact behaviour; first run passes 1024 because it
 * splits into two panes at Tailwind's `lg`, not at `md`.
 *
 * Worth using over a CSS-only `hidden lg:block` when the two branches render
 * different components: hiding with CSS still mounts both, which for first run
 * would mean two live PIXI renderers on one screen.
 */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT) {
  // Seeded from the real width rather than `undefined`. The old initial value
  // meant every caller rendered one frame as "desktop" before the effect
  // corrected it — harmless when it only toggled a class, but first run picks
  // which component to mount, and a wrong first frame there starts a PIXI
  // renderer on a phone just to tear it down.
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < breakpoint)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < breakpoint)
    return () => mql.removeEventListener("change", onChange)
  }, [breakpoint])

  return !!isMobile
}
