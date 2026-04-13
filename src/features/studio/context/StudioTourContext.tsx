import { createContext, useContext, ReactNode, useEffect } from 'react'
import { useStudioTour } from '../hooks/useStudioTour'

type StudioTourContextValue = ReturnType<typeof useStudioTour>

const StudioTourContext = createContext<StudioTourContextValue | undefined>(undefined)

export function StudioTourProvider({ children }: { children: ReactNode }) {
  const tour = useStudioTour()

  // Auto-start mechanism could go here or in StudioLayout
  useEffect(() => {
    // Example: Auto-start if not seen
    if (!tour.hasSeenTour && !tour.isActive) {
        // Small delay to ensure UI is ready
        const timer = setTimeout(() => {
            tour.restartTour()
        }, 1000)
        return () => clearTimeout(timer)
    }
  }, [tour.hasSeenTour, tour.isActive, tour.restartTour])

  return (
    <StudioTourContext.Provider value={tour}>
      {children}
    </StudioTourContext.Provider>
  )
}

export function useStudioTourContext() {
  const context = useContext(StudioTourContext)
  if (context === undefined) {
    throw new Error('useStudioTourContext must be used within a StudioTourProvider')
  }
  return context
}
