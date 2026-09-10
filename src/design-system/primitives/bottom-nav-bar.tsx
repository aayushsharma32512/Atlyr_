import { cn } from "@/lib/utils"
import { Icons } from "@/design-system/icons"

export type BottomNavId =
  | "collections"
  | "search"
  | "studio"
  | "notifications"
  | "profile"

type BottomNavItem = {
  id: BottomNavId
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: BottomNavItem[] = [
  { id: "collections", label: "Collections", icon: Icons.navCollections },
  { id: "search", label: "Search", icon: Icons.navSearch },
  { id: "studio", label: "Studio", icon: Icons.navStudio },
  { id: "notifications", label: "Notifications", icon: Icons.navNotifications },
  { id: "profile", label: "Profile", icon: Icons.navProfile },
]

export interface BottomNavBarProps {
  activeId?: string
  onNavigate?: (id: BottomNavId) => void
  className?: string
}

/** 55h bar. Active tab is just the ink icon — no pill, no fill. */
export function BottomNavBar({ activeId, onNavigate, className }: BottomNavBarProps) {
  return (
    <nav
      className={cn(
        "flex h-control-nav items-center justify-around gap-2 px-8",
        "border-t border-hairline bg-card/95 backdrop-blur",
        "pb-[calc(env(safe-area-inset-bottom,0px)/2)]",
        className,
      )}
      aria-label="Primary navigation"
    >
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const isActive = id === activeId

        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            onClick={onNavigate ? () => onNavigate(id) : undefined}
            className={cn(
              "flex h-control-secondary w-control-secondary items-center justify-center",
              "rounded-control bg-transparent transition-colors",
              isActive ? "text-ink" : "text-taupe",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </button>
        )
      })}
    </nav>
  )
}
