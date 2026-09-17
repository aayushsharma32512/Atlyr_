import { useState } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

export interface CreateBoardDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => Promise<void>
  isSaving?: boolean
}

/**
 * Just a name, nothing to pick. The "+" tile on Collections only ever makes a
 * new board — a "select an existing one" picker had no reason to be here and
 * only made the two actions confusing.
 */
export function CreateBoardDrawer({ open, onOpenChange, onCreate, isSaving = false }: CreateBoardDrawerProps) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName("")
    setError(null)
  }

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Enter a name")
      return
    }
    setError(null)
    await onCreate(trimmed)
    reset()
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DrawerContent>
        <DrawerHeader className="flex flex-row items-center justify-between px-6 pb-2">
          <DrawerTitle>New moodboard</DrawerTitle>
          <DrawerDescription className="sr-only">Name your new moodboard.</DrawerDescription>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <div className="flex flex-col gap-2 px-6 pb-6">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder="e.g. Date Night"
            disabled={isSaving}
            className="h-11 text-body placeholder:text-muted-foreground"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="button" className="mt-2 w-full" onClick={() => void handleSubmit()} disabled={isSaving}>
            Create
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
