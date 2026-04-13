import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStudioTourContext } from '../context/StudioTourContext'
import { useStudioContext } from '../context/StudioContext'

export function StudioTour() {
  const tour = useStudioTourContext()
  const { openScrollUp, closeScrollUp, openStudio } = useStudioContext()
  const step = tour.getCurrentStep()
  const isLastStep = tour.currentStepIndex === tour.steps.length - 1

  return (
    <>
      <AnimatePresence>
        {tour.isActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[70] pointer-events-auto"
            // We don't block clicks entirely because we want specific elements to be clickable
            // Actually, pointer-events-auto on overlay blocks clicks to elements behind it.
            // But we need high z-index elements to pop *through*.
            // The standard way is stacking context. Elements with z-index > 40 will sit on top.
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {tour.isActive && step && (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="fixed z-[80] w-72 flex flex-col gap-3 p-4 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-white/20"
            style={step.tooltipPosition as any}
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-outfit font-bold text-lg leading-tight text-gray-900">{step.title}</h3>
                <p className="font-sans text-sm text-gray-600 mt-1 leading-relaxed">{step.message}</p>
              </div>
              <button 
                onClick={tour.skipTour}
                className="text-gray-400 hover:text-gray-900 transition-colors -mr-1 -mt-1 p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-center justify-end mt-1">
              
              <div className="flex gap-2">
                {tour.currentStepIndex > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      tour.prevStep()
                      if (step.id === 'back-from-details') {
                        closeScrollUp()
                      } else if (step.id === 'save-button') {
                        openScrollUp()
                      }
                    }}
                    className="h-8 px-2 text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    <ChevronLeft size={14} className="mr-1" />
                    Back
                  </Button>
                )}
                
                <Button 
                  size="sm" 
                  onClick={() => {
                    if (step.id === 'click-details') {
                      openScrollUp()
                    } else if (step.id === 'back-from-details') {
                      closeScrollUp()
                    } else if (step.id === 'return-from-product') {
                      openStudio()
                    } else {
                      tour.nextStep()
                    }
                  }}
                  className="h-8 px-3 text-xs font-medium rounded-full bg-gray-900 hover:bg-black text-white"
                >
                  {isLastStep ? 'Finish' : 'Next'}
                  {!isLastStep && <ChevronRight size={14} className="ml-1" />}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
