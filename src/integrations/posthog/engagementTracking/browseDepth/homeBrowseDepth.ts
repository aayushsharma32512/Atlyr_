type HomeContainerKey =
  | "curated_grid"
  | "moodboard_items"
  | "tryons_grid"
  | "recent_styles_rail"

type HomeContainerSummary = {
  containerKey: HomeContainerKey
  uniqueItemsSeenCount: number
  maxPositionSeen: number
  railId?: string
}

const MIN_VISIBLE_RATIO = 0.5
const MIN_VISIBLE_MS = 300

type Candidate = {
  stableKey: string
  position: number
}

class ContainerBrowseDepthTracker {
  private observer: IntersectionObserver | null = null
  private latestRatioByElement = new Map<Element, number>()
  private candidateByElement = new Map<Element, Candidate>()
  private pendingTimerByElement = new Map<Element, number>()

  private seenKeys = new Set<string>()
  private maxPositionSeen = -1
  private flushed = false

  observe(el: Element, candidate: Candidate) {
    if (this.flushed) return
    this.ensureObserver()
    this.candidateByElement.set(el, candidate)
    this.observer?.observe(el)
  }

  unobserve(el: Element) {
    this.observer?.unobserve(el)
    this.candidateByElement.delete(el)
    this.latestRatioByElement.delete(el)
    const timerId = this.pendingTimerByElement.get(el)
    if (timerId) {
      window.clearTimeout(timerId)
      this.pendingTimerByElement.delete(el)
    }
  }

  flush(): { uniqueItemsSeenCount: number; maxPositionSeen: number } | null {
    if (this.flushed) return null
    this.flushed = true
    if (this.seenKeys.size === 0) return null
    return {
      uniqueItemsSeenCount: this.seenKeys.size,
      maxPositionSeen: Math.max(this.maxPositionSeen, 0),
    }
  }

  softReset() {
    this.flushed = false
    this.seenKeys.clear()
    this.maxPositionSeen = -1

    for (const el of this.pendingTimerByElement.keys()) {
      const timerId = this.pendingTimerByElement.get(el)
      if (timerId) window.clearTimeout(timerId)
    }
    this.pendingTimerByElement.clear()

    // Re-arm observation for elements that were previously unobserved after being seen.
    for (const el of this.candidateByElement.keys()) {
      this.observer?.observe(el)
    }
  }

  hardReset() {
    this.flushed = false
    this.seenKeys.clear()
    this.maxPositionSeen = -1

    for (const el of this.pendingTimerByElement.keys()) {
      const timerId = this.pendingTimerByElement.get(el)
      if (timerId) window.clearTimeout(timerId)
    }
    this.pendingTimerByElement.clear()
    this.latestRatioByElement.clear()
    this.candidateByElement.clear()

    this.observer?.disconnect()
    this.observer = null
  }

  private ensureObserver() {
    if (this.observer) return

    this.observer = new IntersectionObserver(
      (entries) => {
        if (this.flushed) return

        for (const entry of entries) {
          const el = entry.target
          const ratio = entry.intersectionRatio ?? 0
          this.latestRatioByElement.set(el, ratio)

          const candidate = this.candidateByElement.get(el)
          if (!candidate) continue

          if (this.seenKeys.has(candidate.stableKey)) {
            this.clearTimer(el)
            this.observer?.unobserve(el)
            continue
          }

          if (ratio >= MIN_VISIBLE_RATIO) {
            if (this.pendingTimerByElement.has(el)) continue
            const timerId = window.setTimeout(() => {
              this.pendingTimerByElement.delete(el)
              const latest = this.latestRatioByElement.get(el) ?? 0
              if (latest < MIN_VISIBLE_RATIO) return

              const latestCandidate = this.candidateByElement.get(el)
              if (!latestCandidate) return
              if (this.seenKeys.has(latestCandidate.stableKey)) return

              this.seenKeys.add(latestCandidate.stableKey)
              this.maxPositionSeen = Math.max(this.maxPositionSeen, latestCandidate.position)
              this.observer?.unobserve(el)
            }, MIN_VISIBLE_MS)

            this.pendingTimerByElement.set(el, timerId)
          } else {
            this.clearTimer(el)
          }
        }
      },
      { threshold: [0, MIN_VISIBLE_RATIO, 1] },
    )
  }

  private clearTimer(el: Element) {
    const timerId = this.pendingTimerByElement.get(el)
    if (!timerId) return
    window.clearTimeout(timerId)
    this.pendingTimerByElement.delete(el)
  }
}

const trackers: Record<HomeContainerKey, ContainerBrowseDepthTracker> = {
  curated_grid: new ContainerBrowseDepthTracker(),
  moodboard_items: new ContainerBrowseDepthTracker(),
  tryons_grid: new ContainerBrowseDepthTracker(),
  recent_styles_rail: new ContainerBrowseDepthTracker(),
}

let recentStylesRailId: string | null = null

export function setHomeRecentStylesRailId(railId: string | null) {
  recentStylesRailId = railId
}

export function observeHomeCard(opts: {
  containerKey: HomeContainerKey
  element: Element
  stableKey: string
  position: number
}) {
  trackers[opts.containerKey].observe(opts.element, { stableKey: opts.stableKey, position: opts.position })
}

export function unobserveHomeCard(containerKey: HomeContainerKey, element: Element) {
  trackers[containerKey].unobserve(element)
}

export function flushHomeBrowseDepth(): HomeContainerSummary[] {
  const summaries: HomeContainerSummary[] = []

  for (const containerKey of Object.keys(trackers) as HomeContainerKey[]) {
    const summary = trackers[containerKey].flush()
    if (!summary) continue

    const base: HomeContainerSummary = {
      containerKey,
      uniqueItemsSeenCount: summary.uniqueItemsSeenCount,
      maxPositionSeen: summary.maxPositionSeen,
    }

    if (containerKey === "recent_styles_rail" && recentStylesRailId) {
      base.railId = recentStylesRailId
    }

    summaries.push(base)
  }

  return summaries
}

export function softResetHomeBrowseDepth() {
  for (const tracker of Object.values(trackers)) {
    tracker.softReset()
  }
}

export function hardResetHomeBrowseDepth() {
  for (const tracker of Object.values(trackers)) {
    tracker.hardReset()
  }
  recentStylesRailId = null
}

