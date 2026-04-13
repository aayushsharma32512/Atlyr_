import { cn } from "@/lib/utils"
import { IconButton } from "./icon-button"

import {
  Folders,
  House,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react"

type BottomNavItem = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: BottomNavItem[] = [
  { id: "home", label: "Home", icon: House },
  { id: "collections", label: "Collections", icon: Folders },
  { id: "studio", label: "Studio", icon: Sparkles },
  { id: "search", label: "Search", icon: Search },
  { id: "profile", label: "Profile", icon: UserRound },
]

export interface BottomNavBarProps {
  activeId?: string
  onNavigate?: (id: string) => void
  className?: string
}

export function BottomNavBar({
  activeId = "studio",
  onNavigate,
  className,
}: BottomNavBarProps) {
  return (
    <nav
      className={cn(
        "border-t border-sidebar-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90",
        "h-[55px] px-[35px] py-1",
        className,
      )}
      aria-label="Primary navigation"
    >
      <ul className="flex h-full w-full items-center justify-between gap-4">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = id === activeId

          return (
            <li key={id}>
              <IconButton
                tone="ghost"
                size="md"
                aria-label={label}
                onClick={onNavigate ? () => onNavigate(id) : undefined}
                className={cn(
                  "text-muted-foreground",
                  isActive && "bg-muted/60 text-primary hover:bg-muted/60",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </IconButton>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
