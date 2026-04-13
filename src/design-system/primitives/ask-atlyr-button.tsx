import { useState, useRef, useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { BotMessageSquare, Search } from "lucide-react"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"

export interface AskAtlyrButtonProps {
  onClick?: () => void
  onSearch?: (query: string) => void
  className?: string
  placeholder?: string
}

export function AskAtlyrButton({
  onClick,
  onSearch,
  className,
  placeholder = "Ask Atlyr...",
}: AskAtlyrButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      onSearch?.(searchQuery.trim())
      setSearchQuery("")
      setIsExpanded(false)
    } else if (e.key === "Escape") {
      setSearchQuery("")
    }
  }

    return (
    <div className={cn("relative w-full p-[1px] bg-transparent", className)}>
      <InputGroup className="relative flex items-center p-0 bg-transparent rounded-full">
          <InputGroupAddon align="inline-end">
            <Search />
          </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
            type="text"
          placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
          className={cn("h-9 w-full text-sm")}
        />
        </InputGroup>
      </div>
  )
}


