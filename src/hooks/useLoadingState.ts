import { useState, useCallback } from 'react';

interface LoadingState {
  isLoading: boolean;
  loadingMessage?: string;
}

export function useLoadingState(initialState: LoadingState = { isLoading: false }) {
  const [loadingState, setLoadingState] = useState<LoadingState>(initialState);

  const startLoading = useCallback((message?: string) => {
    setLoadingState({
      isLoading: true,
      loadingMessage: message
    });
  }, []);

  const stopLoading = useCallback(() => {
    setLoadingState({
      isLoading: false,
      loadingMessage: undefined
    });
  }, []);

  const withLoading = useCallback(async <T>(
    asyncFn: () => Promise<T>,
    message?: string
  ): Promise<T> => {
    startLoading(message);
    try {
      const result = await asyncFn();
      return result;
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  return {
    ...loadingState,
    startLoading,
    stopLoading,
    withLoading
  };
} 