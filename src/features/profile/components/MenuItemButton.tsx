import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

export interface MenuItemButtonProps {
  icon: LucideIcon
  label: string
  onClick?: () => void
  className?: string
}

export function MenuItemButton({ icon: Icon, label, onClick, className }: MenuItemButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-3 py-3 bg-background",
        "text-left transition-colors",
        "hover:bg-gray-50 active:bg-gray-100",
        "focus:outline-none focus:bg-gray-50",
        className
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Icon 
          className="w-7 h-7 pr-2 text-gray-900 flex-shrink-0" 
          strokeWidth={1.5}
        />
        <span className="text-sm font-normal text-gray-900 flex-1">
          {label}
        </span>
      </div>
      <ChevronRight 
        className="w-4 h-4 text-gray-900 flex-shrink-0 ml-2" 
        strokeWidth={2}
      />
    </button>
  )
}

