import { Progress } from "@/components/ui/progress"
import { useDailyLimits } from "@/features/profile/hooks/useDailyLimits"

export function DailyUsageCard() {
  const { data, isLoading, error } = useDailyLimits()

  if (isLoading) {
    return (
      <div className="bg-background rounded-lg p-4 space-y-3 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-4 w-24 bg-gray-100 rounded" />
          <div className="h-3 w-24 bg-gray-100 rounded" />
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="h-3 w-20 bg-gray-100 rounded" />
              <div className="h-3 w-14 bg-gray-100 rounded" />
            </div>
            <div className="h-1.5 bg-gray-100 rounded" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="h-3 w-28 bg-gray-100 rounded" />
              <div className="h-3 w-14 bg-gray-100 rounded" />
            </div>
            <div className="h-1.5 bg-gray-100 rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return null
  }

  const { tryon, likeness } = data

  const tryonPct = Math.min((tryon.count / tryon.limit) * 100, 100)
  const likenessPct = Math.min((likeness.count / likeness.limit) * 100, 100)
  const tryonIndicator = tryonPct >= 80 ? "bg-amber-500" : undefined
  const likenessIndicator = likenessPct >= 80 ? "bg-amber-500" : undefined

  return (
    <div className="bg-background rounded-lg p-2 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Daily usage</h3>
        <p className="text-[11px] text-gray-500">Resets 12:00 AM IST</p>
      </div>

      <div className="space-y-3">
        {/* Try-on usage */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Try-ons</span>
            <span className="text-sm font-medium text-gray-900">
              {tryon.count} / {tryon.limit}
            </span>
          </div>
          <Progress
            value={tryonPct}
            className="h-1.5 bg-gray-100"
            indicatorClassName={tryonIndicator}
          />
          {!tryon.allowed && <p className="text-[11px] text-amber-600">Limit reached</p>}
        </div>

        {/* Likeness usage */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Likeness generations</span>
            <span className="text-sm font-medium text-gray-900">
              {likeness.count} / {likeness.limit}
            </span>
          </div>
          <Progress
            value={likenessPct}
            className="h-1.5 bg-gray-100"
            indicatorClassName={likenessIndicator}
          />
          {!likeness.allowed && <p className="text-[11px] text-amber-600">Limit reached</p>}
        </div>
      </div>
    </div>
  )
}
