import { Trash, Maximize2, Maximize } from "lucide-react"

export interface AvatarCardProps {
  id: string
  imageUrl?: string
  generationDate: string
  isSelected?: boolean
  onSelect?: () => void
  onDelete?: () => void
  onMaximize?: () => void
}

export function AvatarCard({
  imageUrl,
  generationDate,
  isSelected = false,
  onSelect,
  onDelete,
  onMaximize,
}: AvatarCardProps) {
  return (
    <div className="flex flex-col gap-2 items-center relative w-[160px]">
      <button
        type="button"
        onClick={onSelect}
        className={`bg-muted flex flex-col items-end justify-end px-2.5 py-3 relative rounded-[10px] w-full aspect-[160/200] transition-all ${
          isSelected ? "ring-2 ring-primary ring-offset-2" : ""
        }`}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Avatar"
            className="absolute inset-0 w-full h-full object-cover rounded-[10px]"
          />
        )}
        
        {/* Action Icons */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex justify-between z-10">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.()
            }}
            className="bg-accent flex gap-1 h-5 items-center justify-center min-w-[20px] overflow-hidden px-0 py-1 relative rounded-[8px]"
          >
            <Trash className="overflow-hidden relative shrink-0 size-3 text-foreground" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onMaximize?.()
            }}
            className="bg-accent flex gap-1 h-5 items-center justify-center min-w-[20px] overflow-hidden px-0 py-1 relative rounded-[8px]"
          >
            <Maximize className="overflow-hidden relative shrink-0 size-3 text-foreground" />
          </button>
        </div>
      </button>
      
      {/* Generation Date */}
      <div className="flex flex-col gap-1 items-center px-0.5 py-0 relative w-full">
        <div className="flex flex-col gap-[10px] h-4 items-center justify-center px-[22px] py-0 relative w-full">
          <p className="font-normal leading-[10.943px] not-italic overflow-ellipsis overflow-hidden text-xs text-muted-foreground text-center tracking-[-0.1425px] whitespace-pre-wrap">
            {generationDate}
          </p>
        </div>
      </div>
    </div>
  )
}

