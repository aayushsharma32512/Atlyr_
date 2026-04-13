import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface DropdownOption {
  id: string
  label: string
  value?: string
}

export interface DropdownSelectorProps {
  title: string
  options: DropdownOption[]
  selectedId?: string
  onSelect: (id: string) => void
  className?: string
  placeholder?: string
}

export function DropdownSelector({
  title,
  options,
  selectedId,
  onSelect,
  className,
  placeholder = "Select an option",
}: DropdownSelectorProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      <Select
        value={selectedId}
        onValueChange={onSelect}
      >
        <SelectTrigger className="w-full h-11">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.value || option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

