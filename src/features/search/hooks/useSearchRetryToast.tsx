import { useEffect } from "react"

import { ToastAction } from "@/components/ui/toast"
import { useToast } from "@/hooks/use-toast"
import { ProductSearchError } from "@/services/search/searchService"

type UseSearchRetryToastInput = {
  error: unknown
  /** Changes on every new failure, 0 when there is none. A new value shows the toast again. */
  errorKey: number
  onRetry: () => void
}

/** Shows a toast with a Retry action each time a product search fails. */
export function useSearchRetryToast({ error, errorKey, onRetry }: UseSearchRetryToastInput): void {
  const { toast } = useToast()

  useEffect(() => {
    if (!errorKey) return
    toast({
      title: searchErrorTitle(error),
      action: (
        <ToastAction altText="Retry" onClick={onRetry}>
          Retry
        </ToastAction>
      ),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorKey])
}

function searchErrorTitle(error: unknown): string {
  if (error instanceof ProductSearchError && error.code === "image_error") return "The image could not be loaded."
  return "This is taking longer than expected."
}
