import { Loader2, Check } from "lucide-react"

type LikenessStatus = "generating" | "review" | "saved" | "error"

interface LikenessStatusChipProps {
  status: LikenessStatus
  secondsRemaining?: number
}

const STATUS_COPY: Record<LikenessStatus, string> = {
  generating: "Generating likeness",
  review: "Review likeness",
  saved: "Saved",
  error: "Something went wrong",
}

export function LikenessStatusChip({ status, secondsRemaining = 0 }: LikenessStatusChipProps) {
  const showCountdown = status === "generating"
  const displaySeconds = Math.max(0, Math.ceil(secondsRemaining))

  return (
    <div className="absolute right-6 top-6 z-10 flex items-center gap-3 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-medium text-card-foreground">
      <span>{STATUS_COPY[status]}</span>
      <div className="relative flex h-8 w-8 items-center justify-center rounded-full border border-border">
        {status === "saved" ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : status === "generating" ? (
          <>
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden="true" />
            {showCountdown ? (
              <span className="absolute text-[10px] font-semibold leading-none text-foreground">{displaySeconds}</span>
            ) : null}
          </>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" aria-hidden="true" />
        )}
      </div>
    </div>
  )
}

