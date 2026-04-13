export interface GridEntry<T> {
  item: T
  key: string
}

export function buildGridColumns<T>(
  source: T[],
  columnCount: number,
  rowCount: number,
  getItemKey: (item: T, index: number) => string,
): GridEntry<T>[][] {
  const safeColumnCount = Math.max(columnCount, 1)
  if (source.length === 0 || rowCount <= 0 || columnCount <= 0) {
    return Array.from({ length: safeColumnCount }, () => [])
  }

  const maxItems = Math.min(source.length, safeColumnCount * rowCount)
  const itemsToRender = source.slice(0, maxItems)

  const buckets: GridEntry<T>[][] = Array.from({ length: safeColumnCount }, () => [])
  itemsToRender.forEach((item, index) => {
    buckets[index % safeColumnCount].push({
      item,
      key: getItemKey(item, index),
    })
  })

  return buckets
}

