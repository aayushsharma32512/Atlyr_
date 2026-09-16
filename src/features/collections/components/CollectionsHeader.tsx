import type { ReactNode } from "react"

import { TabBar, type TabBarItem } from "@/design-system/primitives"
import { cn } from "@/lib/utils"

interface CollectionsHeaderProps {
  activeTab: string
  onTabChange: (tab: string) => void
  /** The signed-in user's name; the title reads "<first>'s boards". Falls
   *  back to "Your boards" while the profile loads or if the name is blank.
   *  Ignored when `titleContent` is given. */
  ownerName?: string | null
  className?: string
  style?: React.CSSProperties
  /** Defaults to the moodboards/creations/products tabs — a board-detail page
   *  passes its own board list instead, so the two screens share one header. */
  tabs?: TabBarItem[]
  tabsFit?: "equal" | "scroll"
  autoCenterActiveTab?: boolean
  /** Replaces the "<name>'s boards" title — a board-detail page puts its own
   *  back · name · save-count row here instead. */
  titleContent?: ReactNode
}

// Lowercase per the V2 casing rule: tabs, pills, chips and button labels are
// lowercase; only h1s, proper names and "Atlyr" keep their casing.
const TABS = [
  { id: "moodboards", label: "moodboards" },
  { id: "creations", label: "creations" },
  { id: "products", label: "products" },
]

function possessiveTitle(ownerName?: string | null) {
  const first = ownerName?.trim().split(/\s+/)[0]
  if (!first) return "Your boards"
  // "Aanya's boards", but "Lucas' boards" — a trailing s takes a bare apostrophe.
  return first.endsWith("s") ? `${first}' boards` : `${first}'s boards`
}

/** 52h title row, then the 36h tab bar. */
const CollectionsHeader = ({
  activeTab,
  onTabChange,
  ownerName,
  className,
  style,
  tabs = TABS,
  tabsFit = "equal",
  autoCenterActiveTab = false,
  titleContent,
}: CollectionsHeaderProps) => {
  return (
    <header className={cn("bg-background", className)} style={style}>
      {/* No header action — "+ New" is the first tile in the board grid. */}
      <div className="flex h-control-header-title items-center border-b border-hairline px-4">
        {titleContent ?? (
          <h1 className="min-w-0 flex-1 truncate font-display text-title font-medium text-ink">
            {possessiveTitle(ownerName)}
          </h1>
        )}
      </div>
      <TabBar
        items={tabs}
        activeId={activeTab}
        onChange={onTabChange}
        fit={tabsFit}
        autoCenterActive={autoCenterActiveTab}
      />
    </header>
  )
}

export default CollectionsHeader
