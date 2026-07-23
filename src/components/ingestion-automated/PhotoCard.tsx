import type { ReactNode } from 'react'
import { Loader2, X as XIcon, Plus, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TileState = 'available' | 'processing' | 'error' | 'empty'

type TileAction = { icon: ReactNode; label: string; onClick: () => void }

type Props = {
  label: string
  state: TileState
  url?: string | null
  badge?: string
  note?: string
  size?: 'sm' | 'md' | 'xl' | 'lg'
  onExpand?: () => void
  actions?: TileAction[]
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'w-16 h-20',
  md: 'w-24 h-32',
  xl: 'w-32 h-40',
  lg: 'w-full aspect-[3/4]',
}

const STATE_BORDER: Record<TileState, string> = {
  available: 'border-border',
  processing: 'border-border',
  error: 'border-destructive/50',
  empty: 'border-dashed border-border',
}

export function PhotoCard({ label, state, url, badge, note, size = 'md', onExpand, actions }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          'relative rounded-lg border bg-muted overflow-hidden flex items-center justify-center group',
          SIZE_CLASS[size], STATE_BORDER[state]
        )}
      >
        {state === 'available' && url && (
          <img src={url} alt={label} className="w-full h-full object-contain" />
        )}
        {state === 'available' && !url && (
          <span className="text-[10px] text-muted-foreground text-center px-1">No image</span>
        )}
        {state === 'processing' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {state === 'error' && <XIcon className="h-4 w-4 text-destructive" />}
        {state === 'empty' && <Plus className="h-4 w-4 text-muted-foreground/50" />}

        {badge && (
          <span className="absolute top-1 left-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded">{badge}</span>
        )}

        {onExpand && state === 'available' && (
          <button
            onClick={onExpand}
            className="absolute top-1 right-1 bg-black/60 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={`Expand ${label}`}
          >
            <Maximize2 className="h-2.5 w-2.5 text-white" />
          </button>
        )}

        {actions && actions.length > 0 && (
          <div className="absolute bottom-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {actions.map((a, i) => (
              <button
                key={i}
                onClick={a.onClick}
                title={a.label}
                className="bg-black/60 rounded p-1 text-white"
              >
                {a.icon}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] font-medium leading-tight">{label}</p>
      {note && <p className="text-[9.5px] text-muted-foreground leading-tight truncate">{note}</p>}
    </div>
  )
}
