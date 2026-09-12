import type { ReactNode } from "react"

import { useDockAboveKeyboard } from "@/design-system/utils/useDockAboveKeyboard"

export const NAV_HEIGHT = 55
export const DOCK_HEIGHT = 56 // 40 field + 2 × 8 padding

/** The search bar's home: fixed above the nav, hairline on top. */
export function SearchDock({ children }: { children: ReactNode }) {
  const bottom = useDockAboveKeyboard(NAV_HEIGHT)
  return (
    <div className="fixed inset-x-0 z-30 border-t border-hairline bg-background" style={{ bottom }}>
      <div className="mx-auto w-full max-w-[24.5rem] px-4 py-2 md:max-w-[47rem] lg:max-w-[62rem] xl:max-w-[78rem]">{children}</div>
    </div>
  )
}
