import { useState, useCallback } from 'react';

interface ErrorState {
  hasError: boolean;
  error: string | null;
}

export function useErrorHandler() {
  const [errorState, setErrorState] = useState<ErrorState>({
    hasError: false,
    error: null
  });

  const handleError = useCallback((error: unknown, context?: string) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullMessage = context ? `${context}: ${errorMessage}` : errorMessage;
    
    console.error('Error occurred:', { error, context });
    
    setErrorState({
      hasError: true,
      error: fullMessage
    });
  }, []);

  const clearError = useCallback(() => {
    setErrorState({
      hasError: false,
      error: null
    });
  }, []);

  const retry = useCallback((retryFn: () => void) => {
    clearError();
    retryFn();
  }, [clearError]);

  return {
    ...errorState,
    handleError,
    clearError,
    retry
  };
} 