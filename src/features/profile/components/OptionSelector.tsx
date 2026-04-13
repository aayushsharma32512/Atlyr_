import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Option {
  id: string
  label: string
  imageUrl?: string
  color?: string
}

export interface OptionSelectorProps {
  title: string
  options: Option[]
  selectedId?: string
  onSelect: (id: string) => void
  className?: string
}

export function OptionSelector({
  title,
  options,
  selectedId,
  onSelect,
  className,
}: OptionSelectorProps) {
  return (
    <div className={cn("space-y-3", className) + "w-full"}>
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      <div 
        className="overflow-x-auto scrollbar-hide w-full flex-1"
        style={{
          WebkitOverflowScrolling: 'touch',
          scrollBehavior: 'smooth'
        }}
      >
        <div className="flex gap-1 min-w-max pb-3">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={cn(
                "relative aspect-square rounded-lg overflow-hidden transition-all flex-shrink-0",
                "border-2 w-20 h-20",
                selectedId === option.id
                  ? "border-foreground"
                  : "border-transparent hover:border-muted-foreground/50"
              )}
            >
              {option.imageUrl ? (
                <img
                  src={option.imageUrl}
                  alt={option.label}
                  className="w-full h-full object-contain"
                />
              ) : option.color ? (
                <div
                  className="w-full h-full"
                  style={{ backgroundColor: option.color }}
                />
              ) : (
                <div className="w-full h-full bg-muted" />
              )}
              {selectedId === option.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="w-6 h-6 rounded-full bg-foreground flex items-center justify-center">
                    <Check className="w-4 h-4 text-background" />
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
