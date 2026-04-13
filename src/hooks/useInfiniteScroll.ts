import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

interface UseInfiniteScrollOptions {
  itemsPerPage?: number;
  delay?: number;
  threshold?: number;
}

interface UseInfiniteScrollReturn {
  visibleItems: any[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  lastElementRef: (node: HTMLElement | null) => void;
  reset: () => void;
}

export function useInfiniteScroll<T>(
  allItems: T[],
  options: UseInfiniteScrollOptions = {}
): UseInfiniteScrollReturn {
  const {
    itemsPerPage = 6,
    delay = 100,
    threshold = 0.1
  } = options;

  const [visibleItems, setVisibleItems] = useState<T[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement | null>(null);

  // Memoize allItems to prevent infinite re-renders
  const memoizedAllItems = useMemo(() => allItems, [JSON.stringify(allItems)]);

  // Calculate total pages
  const totalPages = Math.ceil(memoizedAllItems.length / itemsPerPage);

  // Load more items
  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;

    setLoading(true);
    
    // Simulate loading delay
    setTimeout(() => {
      const nextPage = currentPage + 1;
      const startIndex = 0;
      const endIndex = nextPage * itemsPerPage;
      const newItems = memoizedAllItems.slice(startIndex, endIndex);
      
      setVisibleItems(newItems);
      setCurrentPage(nextPage);
      setHasMore(nextPage < totalPages);
      setLoading(false);
    }, 500); // Simulate API delay
  }, [currentPage, itemsPerPage, memoizedAllItems, totalPages, loading, hasMore]);

  // Reset to initial state
  const reset = useCallback(() => {
    setVisibleItems([]);
    setCurrentPage(1);
    setLoading(false);
    setHasMore(true);
  }, []);

  // Initialize visible items
  useEffect(() => {
    const initialItems = memoizedAllItems.slice(0, itemsPerPage);
    setVisibleItems(initialItems);
    setCurrentPage(1);
    setHasMore(memoizedAllItems.length > itemsPerPage);
  }, [memoizedAllItems, itemsPerPage]);

  // Intersection observer for last element
  const lastElementRef = useCallback((node: HTMLElement | null) => {
    if (loading) return;
    
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          loadMore();
        }
      },
      { threshold }
    );

    if (node) {
      observerRef.current.observe(node);
    }
  }, [loading, hasMore, loadMore, threshold]);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return {
    visibleItems,
    loading,
    hasMore,
    loadMore,
    lastElementRef,
    reset
  };
} 