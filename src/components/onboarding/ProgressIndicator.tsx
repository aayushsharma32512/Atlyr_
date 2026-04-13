import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  steps: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}

export function ProgressIndicator({ currentStep, totalSteps, steps }: ProgressIndicatorProps) {
  return (
    <div className="w-full mb-8">
      {/* Progress Bar */}
      <div className="relative mb-6">
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-muted transform -translate-y-1/2" />
        <div 
          className="absolute top-1/2 left-0 h-0.5 bg-primary transform -translate-y-1/2 transition-all duration-500 ease-out"
          style={{ width: `${(currentStep / (totalSteps - 1)) * 100}%` }}
        />
        
        {/* Step Dots */}
        <div className="relative flex justify-between">
          {Array.from({ length: totalSteps }, (_, index) => (
            <div
              key={index}
              className={cn(
                "w-8 h-8 rounded-full border-2 flex items-center justify-center bg-background transition-all duration-300",
                index < currentStep
                  ? "border-primary bg-primary text-primary-foreground"
                  : index === currentStep
                  ? "border-primary bg-background text-primary scale-110"
                  : "border-muted text-muted-foreground"
              )}
            >
              {index < currentStep ? (
                <Check className="w-4 h-4" />
              ) : (
                <span className="text-sm font-medium">{index + 1}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Current Step Info */}
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground">
          Step {currentStep + 1} of {totalSteps}
        </p>
        <h2 className="text-header">{steps[currentStep]?.name}</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {steps[currentStep]?.description}
        </p>
      </div>
    </div>
  );
}