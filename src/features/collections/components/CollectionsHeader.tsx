import { TabBar } from "@/design-system/primitives"
import { cn } from "@/lib/utils"

interface CollectionsHeaderProps {
  activeTab: string
  onTabChange: (tab: string) => void
  className?: string
  style?: React.CSSProperties
}

const TABS = [
  { id: "moodboards", label: "Moodboards" },
  { id: "creations", label: "Creations" },
  { id: "products", label: "Products" },
]

/** 52h title row, then the 36h tab bar. */
const CollectionsHeader = ({ activeTab, onTabChange, className, style }: CollectionsHeaderProps) => {
  return (
    <header className={cn("bg-background", className)} style={style}>
      {/* No header action — "+ New" is the first tile in the board grid. */}
      <div className="flex h-control-header-title items-center border-b border-hairline px-4">
        <h1 className="min-w-0 flex-1 font-display text-title font-medium text-ink">Your boards</h1>
      </div>
      <TabBar items={TABS} activeId={activeTab} onChange={onTabChange} />
    </header>
  )
}

export default CollectionsHeader
