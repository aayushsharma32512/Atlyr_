import { useRef, type MouseEvent } from "react"

/** Tap fires onTap; holding for `delay` ms fires onLongPress and swallows the tap. */
export function useLongPress(onTap?: () => void, onLongPress?: () => void, delay = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)

  const start = () => {
    if (!onLongPress) return
    timer.current = setTimeout(() => {
      fired.current = true
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      onLongPress()
    }, delay)
  }
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const onClick = (event: MouseEvent) => {
    event.stopPropagation()
    if (fired.current) {
      fired.current = false
      return
    }
    onTap?.()
  }

  return {
    onClick,
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  }
}
