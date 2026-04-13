import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { OutfitInspirationTile } from "@/design-system/primitives"
import type { MoodboardPreview } from "@/services/collections/collectionsService"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreVertical } from "lucide-react"

interface MoodboardCardProps {
  name: string
  slug?: string
  isSystem?: boolean
  itemCount?: number
  preview?: MoodboardPreview
  onDelete?: (slug: string, name: string) => void
}

const MoodboardCard = ({ name, slug, isSystem = false, itemCount = 0, preview, onDelete }: MoodboardCardProps) => {
  const navigate = useNavigate()
  const items = useMemo(() => preview?.items ?? [], [preview?.items])
  const hasItems = items.length > 0
  const resolveGender = (value?: string | null): "male" | "female" => (value === "male" ? "male" : "female")
  const isClickable = Boolean(slug) && itemCount > 0
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const canDelete = Boolean(onDelete && slug && !isSystem)

  const renderPreviewItem = useCallback(
    (item: NonNullable<typeof items>[number]) => {
      if (item.itemType === "outfit") {
        return (
          <OutfitInspirationTile
            preset="homeCurated"
            wrapperClassName="flex h-full w-full items-center justify-center"
            outfitId={item.id}
            renderedItems={item.renderedItems}
            showTitle={false}
            showChips={false}
            showSaveButton={false}
            sizeMode="fluid"
            fluidLayout="avatar"
            cardClassName="h-full w-full"
            avatarGender={resolveGender(item.gender)}
          />
        )
      }

      return item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt={item.productName ?? "Product preview"}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Preview unavailable</div>
      )
    },
    [resolveGender],
  )

  const handleNavigate = useCallback(() => {
    if (!slug) return
    if (isMenuOpen || isConfirmingDelete) return
    const params = new URLSearchParams({ moodboard: slug })
    navigate(`/home?${params.toString()}`)
  }, [isConfirmingDelete, isMenuOpen, navigate, slug])

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-disabled={isClickable ? undefined : true}
      onClick={isClickable ? handleNavigate : undefined}
      onKeyDown={
        isClickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                handleNavigate()
              }
            }
          : undefined
      }
      className={cn(
        "relative w-full overflow-hidden rounded-2xl bg-card text-left shadow-none transition hover:shadow-sm border border-sidebar-border border-b-1",
        !isClickable && "cursor-default",
      )}
    >
      {canDelete ? (
        <div className="absolute right-2 top-2 z-10">
          <DropdownMenu
            open={isMenuOpen}
            onOpenChange={(open) => {
              setIsMenuOpen(open)
              if (!open) {
                setIsConfirmingDelete(false)
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full bg-card/80"
                aria-label="Moodboard actions"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {isConfirmingDelete ? (
                <div className="flex w-56 flex-col gap-2 px-2 py-2">
                  <div className="text-xs font-medium text-foreground">Delete moodboard?</div>
                  <div className="text-xs text-muted-foreground">
                    This will permanently remove it.
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsConfirmingDelete(false)
                        setIsMenuOpen(false)
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (!slug || !onDelete) return
                        void onDelete(slug, name)
                        setIsConfirmingDelete(false)
                        setIsMenuOpen(false)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={(event) => {
                    event.preventDefault()
                    setIsConfirmingDelete(true)
                  }}
                >
                  Delete moodboard
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <div className="grid aspect-[7/9] grid-cols-2 grid-rows-2 gap-0 overflow-hidden rounded-t-2xl bg-none border border-sidebar-border border-b-1 border-x-0 border-t-0">
        {hasItems ? (
          items.length === 1 ? (
            // 1 item: Full space
            <div className="relative col-span-2 row-span-2 overflow-hidden bg-card p-2">
              {items[0] ? renderPreviewItem(items[0]) : null}
            </div>
          ) : items.length === 2 ? (
            // 2 items: Half and half
            <>
              <div className="relative row-span-2 overflow-hidden bg-card p-2  border-r border-sidebar-border">
                {items[0] ? renderPreviewItem(items[0]) : null}
              </div>
              <div className="relative row-span-2 overflow-hidden bg-card p-2">
                {items[1] ? renderPreviewItem(items[1]) : null}
              </div>
            </>
          ) : (
            // 3+ items: 1 large left + 2 stacked right
            <>
              <div className="relative row-span-2 overflow-hidden bg-card p-1 border-r border-sidebar-border">
                {items[0] ? renderPreviewItem(items[0]) : null}
              </div>
              <div className="relative overflow-hidden bg-card p-1">
                {items[1] ? renderPreviewItem(items[1]) : null}
              </div>
              <div className="relative overflow-hidden bg-card p-1 border-t border-sidebar-border">
                {items[2] ? renderPreviewItem(items[2]) : null}
              </div>
            </>
          )
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              navigate("/search")
            }}
            className="col-span-2 row-span-2 flex flex-col items-center justify-center gap-2 text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40">
              <span className="text-xl font-light">+</span>
            </div>
            <span className="text-xs">Add items</span>
          </button>
        )}
      </div>
      <div className="p-2 text-left">
        <p className="text-sm font-medium text-foreground">{name}</p>
        {/* <p className="text-xs text-muted-foreground">{isSystem ? "System" : "Moodboard"}</p> */}
      </div>

    </div>
  )
}

export default MoodboardCard
