type EntityType = "product" | "outfit"

type SearchResultsCandidate = {
  entityType: EntityType
  entityId: string
  position: number
}

type SearchResultsSummary = {
  uniqueItemsSeenCount: number
  maxPositionSeen: number
}

const MIN_VISIBLE_RATIO = 0.5
const MIN_VISIBLE_MS = 300

function stableItemKey(entityType: EntityType, entityId: string): string {
  return `${entityType}:${entityId}`
}

class SearchResultsBrowseDepthTracker {
  private observer: IntersectionObserver | null = null
  private latestRatioByElement = new Map<Element, number>()
  private candidateByElement = new Map<Element, SearchResultsCandidate>()
  private pendingTimerByElement = new Map<Element, number>()

  private seenKeys = new Set<string>()
  private maxPositionSeen = -1
  private flushed = false

  observeCard(el: Element, candidate: SearchResultsCandidate) {
    if (this.flushed) return
    this.ensureObserver()
    this.candidateByElement.set(el, candidate)
    this.observer?.observe(el)
  }

  unobserveCard(el: Element) {
    this.observer?.unobserve(el)
    this.candidateByElement.delete(el)
    this.latestRatioByElement.delete(el)
    const timerId = this.pendingTimerByElement.get(el)
    if (timerId) {
      window.clearTimeout(timerId)
      this.pendingTimerByElement.delete(el)
    }
  }

  flush(): SearchResultsSummary | null {
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

          const key = stableItemKey(candidate.entityType, candidate.entityId)
          if (this.seenKeys.has(key)) {
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

              const stableKey = stableItemKey(latestCandidate.entityType, latestCandidate.entityId)
              if (this.seenKeys.has(stableKey)) return

              this.seenKeys.add(stableKey)
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

const tracker = new SearchResultsBrowseDepthTracker()

export function observeSearchResultsCard(opts: {
  element: Element
  entityType: EntityType
  entityId: string
  position: number
}) {
  tracker.observeCard(opts.element, {
    entityType: opts.entityType,
    entityId: opts.entityId,
    position: opts.position,
  })
}

export function unobserveSearchResultsCard(element: Element) {
  tracker.unobserveCard(element)
}

export function flushSearchResultsBrowseDepth(): SearchResultsSummary | null {
  return tracker.flush()
}

export function softResetSearchResultsBrowseDepth() {
  tracker.softReset()
}

export function hardResetSearchResultsBrowseDepth() {
  tracker.hardReset()
}
