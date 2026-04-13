import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface GenderSelectorProps {
  selectedGender: string;
  onSelect: (gender: string) => void;
}

export function GenderSelector({ selectedGender, onSelect }: GenderSelectorProps) {
  const bodyTypeOptions = [
    {
      value: 'male',
      label: 'Male',
      icon: '👨'
    },
    {
      value: 'female',
      label: 'Female', 
      icon: '👩'
    }
  ];

  // Determine which option should be selected based on the backend gender value
  const getSelectedOption = () => {
    if (selectedGender === 'male') {
      return 'male';
    }
    if (selectedGender === 'female') {
      return 'female';
    }
    return selectedGender;
  };

  const selectedOption = getSelectedOption();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        {bodyTypeOptions.map((option, index) => (
          <motion.div
            key={option.value}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1, duration: 0.3 }}
          >
            <button
              type="button"
              onClick={() => onSelect(option.value)}
                              className={cn(
                  "w-full p-3 rounded-xl border-2 transition-all duration-200 text-left group",
                  "hover:shadow-md hover:-translate-y-0.5",
                  selectedOption === option.value
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border bg-background hover:border-muted-foreground"
                )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all duration-200",
                  selectedOption === option.value
                    ? "bg-primary/10 scale-110"
                    : "bg-accent group-hover:bg-accent/80"
                )}>
                  {option.icon}
                </div>
                <div className="flex-1">
                  <h3 className={cn(
                    "font-semibold transition-colors duration-200",
                    selectedOption === option.value
                      ? "text-primary"
                      : "text-foreground"
                  )}>
                    {option.label}
                  </h3>
                </div>
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 transition-all duration-200",
                  selectedOption === option.value
                    ? "border-primary bg-primary"
                    : "border-muted-foreground"
                )}>
                  {selectedOption === option.value && (
                    <div className="w-full h-full rounded-full bg-primary-foreground scale-50" />
                  )}
                </div>
              </div>
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}