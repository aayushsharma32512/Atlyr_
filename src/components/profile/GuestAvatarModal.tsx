import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AvatarSelectionStep } from '@/components/onboarding/AvatarSelectionStep';
import { useGuest } from '@/contexts/GuestContext';

type AvatarStep = 'face-shape' | 'skin-tone' | 'hairstyle';
type WizardStep = 'gender' | AvatarStep;

interface FormDataState {
  gender: 'male' | 'female';
  selectedFaceShape: string;
  selectedSkinTone: string;
  selectedHairstyle: string;
  selectedAvatarId: string;
  selectedAvatarImageUrl: string;
  selectedAvatarScalingFactor: number;
}

interface GuestAvatarModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultGender?: 'male' | 'female';
}

export function GuestAvatarModal({ open, onOpenChange, defaultGender = 'male' }: GuestAvatarModalProps) {
  const { applyGuestAvatarSelection, guestState } = useGuest();
  const initialHeight = (guestState?.preferences && typeof (guestState.preferences as any).heightCm === 'number') ? (guestState.preferences as any).heightCm : 175;
  const [currentStep, setCurrentStep] = useState<WizardStep>('gender');
  const [formData, setFormData] = useState<FormDataState>({
    gender: defaultGender,
    selectedFaceShape: '',
    selectedSkinTone: '',
    selectedHairstyle: '',
    selectedAvatarId: '',
    selectedAvatarImageUrl: '',
    selectedAvatarScalingFactor: 0.17,
  });
  // Keep a string for the input so users can clear and retype; parse on blur/submit
  const [heightInput, setHeightInput] = useState<string>(String(initialHeight));
  const [heightCm, setHeightCm] = useState<number>(initialHeight);

  const clampHeight = (n: number) => Math.max(120, Math.min(230, Math.round(n)));
  const commitHeightFromInput = () => {
    const n = Number(heightInput);
    if (Number.isFinite(n)) {
      setHeightCm(clampHeight(n));
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'gender':
        return true;
      case 'face-shape':
        return !!formData.selectedFaceShape;
      case 'skin-tone':
        return !!formData.selectedSkinTone;
      case 'hairstyle':
        return !!formData.selectedHairstyle && !!formData.selectedAvatarId;
      default:
        return false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>Avatar setup</DialogTitle>
          <DialogDescription>Choose an avatar and set your height preference.</DialogDescription>
        </DialogHeader>
        <div className="h-[420px] overflow-y-auto">
          {currentStep === 'gender' ? (
            <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">Choose your gender</h3>
                <p className="text-sm text-muted-foreground">This helps us show the right avatar heads</p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant={formData.gender === 'male' ? 'default' : 'outline'}
                  onClick={() => setFormData(prev => ({ ...prev, gender: 'male' }))}
                >
                  Male
                </Button>
                <Button
                  variant={formData.gender === 'female' ? 'default' : 'outline'}
                  onClick={() => setFormData(prev => ({ ...prev, gender: 'female' }))}
                >
                  Female
                </Button>
              </div>
              <div className="w-full max-w-xs space-y-2">
                <label className="text-sm font-medium">Height (cm)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  className="w-full h-9 px-3 rounded-md border border-border bg-background"
                  value={heightInput}
                  min={120}
                  max={230}
                  step={1}
                  onChange={(e) => {
                    // allow empty or partial numeric input
                    setHeightInput(e.target.value);
                  }}
                  onBlur={commitHeightFromInput}
                />
                <p className="text-xs text-muted-foreground">Used to scale the avatar proportionally.</p>
              </div>
            </div>
          ) : (
            <AvatarSelectionStep
              avatarStep={currentStep}
              formData={formData as unknown as { gender: string; selectedFaceShape: string; selectedSkinTone: string; selectedHairstyle: string; }}
              onUpdateFormData={(updates: Partial<FormDataState>) => setFormData(prev => ({ ...prev, ...updates }))}
            />
          )}
        </div>

        <div className="flex justify-between pt-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Skip</Button>
          </div>
          <div className="flex gap-2">
            {currentStep !== 'gender' && (
              <Button
                variant="outline"
                onClick={() => setCurrentStep(currentStep === 'face-shape' ? 'gender' : currentStep === 'skin-tone' ? 'face-shape' : 'skin-tone')}
              >
                Back
              </Button>
            )}
            {currentStep === 'hairstyle' ? (
              <Button
                disabled={!canProceed()}
                onClick={() => {
                  // Ensure latest input is committed
                  const n = Number(heightInput);
                  const finalHeight = Number.isFinite(n) ? clampHeight(n) : heightCm;
                  applyGuestAvatarSelection(
                    {
                      headId: formData.selectedAvatarId || null,
                      imageUrl: formData.selectedAvatarImageUrl || null,
                      scalingFactor: formData.selectedAvatarScalingFactor || 0.17,
                      gender: formData.gender,
                    },
                    { heightCm: finalHeight }
                  );
                  onOpenChange(false);
                }}
              >
                Use this avatar
              </Button>
            ) : (
              <Button
                disabled={!canProceed()}
                onClick={() => setCurrentStep(currentStep === 'gender' ? 'face-shape' : currentStep === 'face-shape' ? 'skin-tone' : 'hairstyle')}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
