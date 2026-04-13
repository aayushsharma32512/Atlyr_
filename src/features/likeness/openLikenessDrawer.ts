import type { LikenessDrawerOpenDetail } from "./types"

export function openLikenessDrawer(detail: LikenessDrawerOpenDetail) {
  if (typeof window === "undefined") {
    return
  }
  const event = new CustomEvent<LikenessDrawerOpenDetail>("openLikenessDrawer", { detail })
  window.dispatchEvent(event)
}


