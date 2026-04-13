import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { DropdownSelector, type DropdownOption } from "./DropdownSelector"
import { OptionSelector, type Option } from "./OptionSelector"

export interface SelectionSection {
  title: string
  type?: "image" | "dropdown" // Default to "image" for backward compatibility
  options: Option[] | DropdownOption[]
}

export interface ExpandableDetailCardProps {
  title: string
  icon?: React.ReactNode
  iconUrl?: string
  items: Array<{ label: string; value?: string }>
  selectionSections?: SelectionSection[]
  onSelectionChange?: (sectionTitle: string, optionId: string) => void
  selectedValues?: Record<string, string>
  className?: string
}

export function ExpandableDetailCard({
  title,
  icon,
  iconUrl,
  items,
  selectionSections = [],
  onSelectionChange,
  selectedValues,
  className,
}: ExpandableDetailCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selections, setSelections] = useState<Record<string, string>>({})

  useEffect(() => {
    if (selectedValues) {
      setSelections(selectedValues)
    }
  }, [selectedValues])

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
  }

  const handleSelect = (sectionTitle: string, optionId: string) => {
    setSelections((prev) => ({
      ...prev,
      [sectionTitle]: optionId,
    }))
    onSelectionChange?.(sectionTitle, optionId)
  }

  return (
    <div
      className={cn(
        "bg-card rounded-[18px] border border-border overflow-hidden transition-all",
        className
      )}
      style={{ boxSizing: "border-box" }}
    >
      {/* Header - Always Visible */}
      <div
        className="p-6 cursor-pointer"
        onClick={handleToggle}
      >
        <div className="flex items-start gap-4">
          {/* Icon/Image */}
          <div className="w-16 h-16 rounded-[12px] bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
            {iconUrl ? (
              <img
                src={iconUrl}
                alt={title}
                className="w-full h-full object-cover"
                style={{ borderRadius: 12 }}
              />
            ) : (
              icon || <div className="w-full h-full bg-muted" />
            )}
          </div>
          {/* Labels and Values */}
          <div className="flex-1 flex flex-col">
            <h3 className="text-base font-semibold text-foreground mb-1">
              {title}
            </h3>
            {items.map((item, index) => (
              <span
                key={index}
                className={
                  "text-[17px] leading-[1.05] text-muted-foreground font-normal" +
                  (index === 0 ? " mt-1" : "")
                }
                style={{
                  marginTop: index === 0 ? 0 : undefined,
                  fontSize: "16px",
                  lineHeight: "22px"
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
          {/* Expand/Collapse Icon */}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              handleToggle()
            }}
            className="flex-shrink-0 mt-2"
            style={{ minWidth: 0 }}
          >
            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-5 h-5 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && selectionSections.length > 0 && (
        <div className="px-6 pb-6 space-y-6 pt-6 max-w-[90vw]">
          {selectionSections.map((section, index) => {
            const sectionType = section.type || "image"
            const isLast = index === selectionSections.length - 1
            
            if (sectionType === "dropdown") {
              return (
                <DropdownSelector
                  key={section.title}
                  title={section.title}
                  options={section.options as DropdownOption[]}
                  selectedId={selections[section.title]}
                  onSelect={(optionId) => handleSelect(section.title, optionId)}
                  className={!isLast ? "pb-6" : ""}
                />
              )
            }
            
            return (
              <OptionSelector
                key={section.title}
                title={section.title}
                options={section.options as Option[]}
                selectedId={selections[section.title]}
                onSelect={(optionId) => handleSelect(section.title, optionId)}
                className={!isLast ? "pb-6" : ""}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
