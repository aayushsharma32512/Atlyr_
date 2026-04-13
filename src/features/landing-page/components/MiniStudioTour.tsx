import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMiniStudioTour } from '../hooks/useMiniStudioTour'

interface MiniStudioTourProps {
  tour: ReturnType<typeof useMiniStudioTour>
}

export function MiniStudioTour({ tour }: MiniStudioTourProps) {
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
            className="absolute inset-0 bg-black/60 z-40 pointer-events-auto overflow-hidden"
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
            className="absolute z-[60] w-64 flex flex-col gap-3 p-4 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-white/20"
            style={step.tooltipPosition}
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

            <div className="flex items-center justify-between mt-1">
              <div className="flex gap-1">
                {tour.steps.map((_, idx) => (
                  <div 
                    key={idx}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      idx === tour.currentStepIndex ? 'w-4 bg-gray-900' : 'w-1.5 bg-gray-200'
                    }`}
                  />
                ))}
              </div>
              
              <Button 
                size="sm" 
                onClick={tour.nextStep}
                className="h-8 px-3 text-xs font-medium rounded-full bg-gray-900 hover:bg-black text-white"
              >
                {isLastStep ? 'Finish' : 'Next'}
                {!isLastStep && <ChevronRight size={14} className="ml-1" />}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
