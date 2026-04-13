import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronRight, ChevronLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ProgressIndicator } from './ProgressIndicator';
import { WelcomeStep } from './WelcomeStep';
import { PersonalInfoStep } from './PersonalInfoStep';
import { AvatarSelectionStep } from './AvatarSelectionStep';
import { CompleteStep } from './CompleteStep';

interface OnboardingFlowProps {
  onComplete: (user: {
    name: string;
    dateOfBirth: string;
    gender: string;
    city: string;
    selectedFaceShape: string;
    selectedSkinTone: string;
    selectedHairstyle: string;
    selectedAvatarId: string;
    selectedAvatarImageUrl: string;
    selectedAvatarScalingFactor: number;
    socialHandle?: string;
  }) => void;
}

type OnboardingStep = 'welcome' | 'personal-info' | 'avatar-selection' | 'complete';
type AvatarStep = 'face-shape' | 'skin-tone' | 'hairstyle';

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [avatarStep, setAvatarStep] = useState<AvatarStep>('face-shape');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // const [showFemininePopup, setShowFemininePopup] = useState(false); // Commented out feminine popup
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    day: '',
    month: '',
    year: '',
    // height inputs with defaults
    heightUnit: 'cm' as 'cm' | 'ftin',
    heightCmInput: '',
    heightFeet: '',
    heightInches: '',
    gender: '',
    city: '',
    selectedFaceShape: '',
    selectedSkinTone: '',
    selectedHairstyle: '',
    selectedAvatarId: '',
    selectedAvatarImageUrl: '',
    selectedAvatarScalingFactor: 0.17,
    
    socialHandle: '',
  });
  const [dobError, setDobError] = useState<string | null>(null);

  // Define steps for progress indicator
  const steps = [
    { id: 'welcome', name: 'Welcome', description: 'Get started with ATLYR' },
    { id: 'personal-info', name: 'About You', description: 'Tell us about yourself' },
    { id: 'avatar-selection', name: 'Your Avatar', description: avatarStep === 'face-shape' ? 'Choose your closest face shape' : avatarStep === 'skin-tone' ? 'Choose your skin tone' : 'Choose your hairstyle' },
    { id: 'complete', name: 'Complete', description: 'All set to explore!' },
  ];

  const currentStepIndex = steps.findIndex(step => step.id === currentStep);

  const updateFormData = (updates: Partial<typeof formData>) => {
    // Handle gender mapping - now direct mapping since frontend uses male/female
    if (updates.gender) {
      // No mapping needed since frontend now uses male/female directly
      // Keep the values as they are
    }
    
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const handleNext = async () => {
    switch (currentStep) {
      case 'welcome':
        setCurrentStep('personal-info');
        break;
      case 'personal-info': {
        // Validate date of birth
        if (!formData.name || !formData.day || !formData.month || !formData.year || !formData.gender || !formData.city) return;
        // Basic height presence validation (optional): allow empty; we'll convert later on complete
        const dobString = `${formData.year}-${formData.month.padStart(2, '0')}-${formData.day.padStart(2, '0')}`;
        const dob = new Date(dobString);
        const now = new Date();
        const minDate = new Date('1900-01-01');
        if (
          isNaN(dob.getTime()) ||
          dob > now ||
          dob < minDate ||
          parseInt(formData.year) < 1900 ||
          parseInt(formData.year) > now.getFullYear()
        ) {
          setDobError('Please enter a valid date of birth.');
          return;
        }
        setDobError(null);
        setCurrentStep('avatar-selection');
        setAvatarStep('face-shape');
        break;
      }
      case 'avatar-selection':
        if (avatarStep === 'face-shape' && formData.selectedFaceShape) {
          setAvatarStep('skin-tone');
        } else if (avatarStep === 'skin-tone' && formData.selectedSkinTone) {
          setAvatarStep('hairstyle');
        } else if (avatarStep === 'hairstyle' && formData.selectedHairstyle) {
          setCurrentStep('complete');
        }
        break;
      case 'complete':
        try {
          setIsSubmitting(true);
          const dobString = `${formData.year}-${formData.month.padStart(2, '0')}-${formData.day.padStart(2, '0')}`;
          // Convert height to centimeters
          const heightCm = (() => {
            if (formData.heightUnit === 'cm') {
              const val = parseFloat(formData.heightCmInput);
              return Number.isFinite(val) ? Math.round(val) : undefined;
            } else {
              const feet = parseFloat(formData.heightFeet);
              const inches = parseFloat(formData.heightInches || '0');
              if (!Number.isFinite(feet)) return undefined;
              const totalInches = feet * 12 + (Number.isFinite(inches) ? inches : 0);
              const cm = totalInches * 2.54; // 1 inch = 2.54 cm
              return Math.round(cm);
            }
          })();
          await onComplete({
            name: formData.name,
            dateOfBirth: dobString,
            gender: formData.gender,
            city: formData.city,
            selectedFaceShape: formData.selectedFaceShape,
            selectedSkinTone: formData.selectedSkinTone,
            selectedHairstyle: formData.selectedHairstyle,
            selectedAvatarId: formData.selectedAvatarId,
            selectedAvatarImageUrl: formData.selectedAvatarImageUrl,
            selectedAvatarScalingFactor: formData.selectedAvatarScalingFactor,
            socialHandle: formData.socialHandle || undefined,
            // We will pass height as an optional extra field via spread and let Index.tsx include it
            ...(heightCm ? { heightCm } : {}),
          });
        } catch (error) {
          console.error('Failed to complete onboarding:', error);
          toast({
            title: "Onboarding Error",
            description: "There was a problem saving your profile. Please try again.",
            variant: "destructive"
          });
        } finally {
          setIsSubmitting(false);
        }
        break;
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case 'personal-info':
        setCurrentStep('welcome');
        break;
      case 'avatar-selection':
        if (avatarStep === 'skin-tone') {
          setAvatarStep('face-shape');
        } else if (avatarStep === 'hairstyle') {
          setAvatarStep('skin-tone');
        } else {
          setCurrentStep('personal-info');
        }
        break;
      case 'complete':
        setCurrentStep('avatar-selection');
        break;
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'welcome':
        return true;
      case 'personal-info':
        return (
          formData.name &&
          formData.day &&
          formData.month &&
          formData.year &&
          formData.gender &&
          formData.city &&
          !dobError
        );
      case 'avatar-selection':
        if (avatarStep === 'face-shape') {
          return formData.selectedFaceShape;
        } else if (avatarStep === 'skin-tone') {
          return formData.selectedSkinTone;
        } else if (avatarStep === 'hairstyle') {
          return formData.selectedHairstyle;
        }
        return false;
      case 'complete':
        return true;
      default:
        return false;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/10 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-lg"
      >
        <Card className="shadow-premium border-0 bg-card/95 backdrop-blur-sm">
          <CardContent className="p-8">
            {/* Progress Indicator */}
            {currentStep !== 'welcome' && (
              <ProgressIndicator
                currentStep={currentStepIndex}
                totalSteps={steps.length}
                steps={steps}
              />
            )}

            {/* Step Content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep + (currentStep === 'avatar-selection' ? `-${avatarStep}` : '')}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4, ease: "easeInOut" }}
              >
                {currentStep === 'welcome' && <WelcomeStep />}

                {currentStep === 'personal-info' && (
                  <PersonalInfoStep
                    formData={formData}
                    onUpdateFormData={updateFormData}
                    dobError={dobError}
                  />
                )}

                {currentStep === 'avatar-selection' && (
                  <AvatarSelectionStep
                    avatarStep={avatarStep}
                    formData={formData}
                    onUpdateFormData={updateFormData}
                  />
                )}

                {currentStep === 'complete' && <CompleteStep />}
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex gap-3 mt-8"
            >
              {currentStep !== 'welcome' && (
                <Button 
                  variant="outline" 
                  onClick={handleBack} 
                  className="flex-1 h-12 transition-all duration-200 hover:shadow-md"
                >
                  <ChevronLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}
              <Button 
                onClick={handleNext} 
                disabled={!canProceed() || isSubmitting}
                className={cn(
                  "h-12 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
                  currentStep === 'welcome' ? "w-full" : "flex-1"
                )}
              >
                {isSubmitting && currentStep === 'complete' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    {currentStep === 'complete' ? 'Get Started' : 'Continue'}
                    {currentStep !== 'complete' && <ChevronRight className="w-4 h-4 ml-2" />}
                  </>
                )}
              </Button>
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Feminine Body Type Popup */}
      {/* Removed feminine popup logic */}
    </div>
  );
}