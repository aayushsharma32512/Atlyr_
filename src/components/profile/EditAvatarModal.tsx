import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { useAvatarHeads } from '@/hooks/useAvatarHeads';
import { useProfile } from '@/hooks/useProfile';
import { cn } from '@/lib/utils';
import { Loader2, Check } from 'lucide-react';
import { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;

interface EditAvatarModalProps {
  currentProfile: Profile;
  onAvatarUpdated: () => void;
}

type AvatarStep = 'face-shape' | 'skin-tone' | 'hairstyle';

export function EditAvatarModal({ currentProfile, onAvatarUpdated }: EditAvatarModalProps) {
  const [currentStep, setCurrentStep] = useState<AvatarStep>('face-shape');
  const [selectedFaceShape, setSelectedFaceShape] = useState(currentProfile.selected_face_shape || '');
  const [selectedSkinTone, setSelectedSkinTone] = useState(currentProfile.selected_skin_tone || '');
  const [selectedHairstyle, setSelectedHairstyle] = useState(currentProfile.selected_hairstyle || '');
  const [selectedAvatarId, setSelectedAvatarId] = useState(currentProfile.selected_avatar_id || '');
  const [selectedAvatarImageUrl, setSelectedAvatarImageUrl] = useState(currentProfile.selected_avatar_image_url || '');
  const [selectedAvatarScalingFactor, setSelectedAvatarScalingFactor] = useState(currentProfile.selected_avatar_scaling_factor || 0.17);
  const [isSaving, setIsSaving] = useState(false);

  const { updateAvatarSelections } = useProfile();
  const { getFaceShapes, getSkinTones, getHairstyles } = useAvatarHeads();

  const handleSave = async () => {
    if (!selectedFaceShape || !selectedSkinTone || !selectedHairstyle) {
      return;
    }

    setIsSaving(true);
    try {
      await updateAvatarSelections(
        selectedFaceShape,
        selectedSkinTone,
        selectedHairstyle,
        selectedAvatarId,
        selectedAvatarImageUrl,
        selectedAvatarScalingFactor
      );
      onAvatarUpdated();
    } catch (error) {
      console.error('Failed to update avatar:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'face-shape':
        return !!selectedFaceShape;
      case 'skin-tone':
        return !!selectedSkinTone;
      case 'hairstyle':
        return !!selectedHairstyle;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep === 'face-shape') {
      setCurrentStep('skin-tone');
    } else if (currentStep === 'skin-tone') {
      setCurrentStep('hairstyle');
    }
  };

  const handleBack = () => {
    if (currentStep === 'skin-tone') {
      setCurrentStep('face-shape');
    } else if (currentStep === 'hairstyle') {
      setCurrentStep('skin-tone');
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress Steps */}
      <div className="flex items-center justify-between mb-6">
        {(['face-shape', 'skin-tone', 'hairstyle'] as AvatarStep[]).map((step, index) => (
          <div key={step} className="flex items-center">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium",
              currentStep === step 
                ? "bg-primary text-primary-foreground" 
                : index < ['face-shape', 'skin-tone', 'hairstyle'].indexOf(currentStep)
                ? "bg-green-500 text-white"
                : "bg-muted text-muted-foreground"
            )}>
              {index < ['face-shape', 'skin-tone', 'hairstyle'].indexOf(currentStep) ? (
                <Check className="w-4 h-4" />
              ) : (
                index + 1
              )}
            </div>
            {index < 2 && (
              <div className={cn(
                "w-8 h-0.5 mx-2",
                index < ['face-shape', 'skin-tone', 'hairstyle'].indexOf(currentStep)
                  ? "bg-green-500"
                  : "bg-muted"
              )} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="h-[400px] overflow-y-auto">
        {currentStep === 'face-shape' && (
          <FaceShapeStep
            gender={currentProfile.gender || 'male'}
            selectedFaceShape={selectedFaceShape}
            onSelect={setSelectedFaceShape}
          />
        )}
        
        {currentStep === 'skin-tone' && (
          <SkinToneStep
            gender={currentProfile.gender || 'male'}
            faceShape={selectedFaceShape}
            selectedSkinTone={selectedSkinTone}
            onSelect={setSelectedSkinTone}
          />
        )}
        
        {currentStep === 'hairstyle' && (
          <HairstyleStep
            gender={currentProfile.gender || 'male'}
            faceShape={selectedFaceShape}
            skinTone={selectedSkinTone}
            selectedHairstyle={selectedHairstyle}
            onSelect={(hairstyle, avatarId, scalingFactor, imageUrl) => {
              setSelectedHairstyle(hairstyle);
              setSelectedAvatarId(avatarId);
              setSelectedAvatarScalingFactor(scalingFactor);
              setSelectedAvatarImageUrl(imageUrl);
            }}
          />
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between pt-4">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 'face-shape'}
        >
          Back
        </Button>
        
        <div className="flex gap-2">
          {currentStep === 'hairstyle' ? (
            <DialogClose asChild>
              <Button
                onClick={handleSave}
                disabled={!canProceed() || isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Avatar'
                )}
              </Button>
            </DialogClose>
          ) : (
            <Button
              onClick={handleNext}
              disabled={!canProceed()}
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Face Shape Step Component
function FaceShapeStep({ 
  gender, 
  selectedFaceShape, 
  onSelect 
}: { 
  gender: string; 
  selectedFaceShape: string; 
  onSelect: (faceShape: string) => void; 
}) {
  const { getFaceShapes, loading } = useAvatarHeads();
  const [faceShapes, setFaceShapes] = useState<Array<{
    id: string;
    name: string;
    image_url: string;
    description: string;
  }>>([]);

  useEffect(() => {
    const loadFaceShapes = async () => {
      const shapes = await getFaceShapes(gender);
      setFaceShapes(shapes);
    };
    loadFaceShapes();
  }, [gender, getFaceShapes]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold mb-2">Choose your face shape</h3>
        <p className="text-sm text-muted-foreground">Select the face shape that most closely matches yours</p>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-2">
        {faceShapes.map((shape) => (
          <Card
            key={shape.id}
            className={cn(
              "cursor-pointer transition-all duration-300 hover:shadow-md",
              selectedFaceShape === shape.id 
                ? "ring-2 ring-primary shadow-md bg-primary/5" 
                : "hover:shadow-sm"
            )}
            onClick={() => onSelect(shape.id)}
          >
            <CardContent className="p-2">
              <div className="aspect-square relative mb-1 overflow-hidden rounded-lg flex items-center justify-center">
                <img
                  src={shape.image_url}
                  alt={shape.name}
                  className="w-3/4 h-3/4 object-contain"
                />
                {selectedFaceShape === shape.id && (
                  <div className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                    <Check className="w-2 h-2 text-primary-foreground" />
                  </div>
                )}
              </div>
              <p className="text-xs font-medium text-center">{shape.name}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Skin Tone Step Component
function SkinToneStep({ 
  gender, 
  faceShape, 
  selectedSkinTone, 
  onSelect 
}: { 
  gender: string; 
  faceShape: string; 
  selectedSkinTone: string; 
  onSelect: (skinTone: string) => void; 
}) {
  const { getSkinTones, loading } = useAvatarHeads();
  const [skinTones, setSkinTones] = useState<Array<{
    id: string;
    name: string;
    image_url: string;
  }>>([]);

  useEffect(() => {
    const loadSkinTones = async () => {
      if (faceShape) {
        const tones = await getSkinTones(gender, faceShape);
        setSkinTones(tones);
      }
    };
    loadSkinTones();
  }, [gender, faceShape, getSkinTones]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold mb-2">Choose your skin tone</h3>
        <p className="text-sm text-muted-foreground">Select the skin tone that most closely matches yours</p>
      </div>
      <div className="flex-1 grid grid-cols-3 gap-2">
        {skinTones.map((tone) => (
          <Card
            key={tone.id}
            className={cn(
              "cursor-pointer transition-all duration-300 hover:shadow-md",
              selectedSkinTone === tone.id 
                ? "ring-2 ring-primary shadow-md bg-primary/5" 
                : "hover:shadow-sm"
            )}
            onClick={() => onSelect(tone.id)}
          >
            <CardContent className="p-2">
              <div className="aspect-square relative mb-1 overflow-hidden rounded-lg flex items-center justify-center">
                <img
                  src={tone.image_url}
                  alt={tone.name}
                  className="w-3/4 h-3/4 object-contain"
                />
                {selectedSkinTone === tone.id && (
                  <div className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                    <Check className="w-2 h-2 text-primary-foreground" />
                  </div>
                )}
              </div>
              <p className="text-xs font-medium text-center">{tone.name}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Hairstyle Step Component
function HairstyleStep({ 
  gender, 
  faceShape, 
  skinTone, 
  selectedHairstyle, 
  onSelect 
}: { 
  gender: string; 
  faceShape: string; 
  skinTone: string; 
  selectedHairstyle: string; 
  onSelect: (hairstyle: string, avatarId: string, scalingFactor: number, imageUrl: string) => void; 
}) {
  const { getHairstyles, loading } = useAvatarHeads();
  const [hairstyles, setHairstyles] = useState<Array<{
    id: string;
    name: string;
    image_url: string;
    avatar_id: string;
    scaling_factor: number;
  }>>([]);

  useEffect(() => {
    const loadHairstyles = async () => {
      if (faceShape && skinTone) {
        const styles = await getHairstyles(gender, faceShape, skinTone);
        setHairstyles(styles);
      }
    };
    loadHairstyles();
  }, [gender, faceShape, skinTone, getHairstyles]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold mb-2">Choose your hairstyle</h3>
        <p className="text-sm text-muted-foreground">Select the hairstyle that most closely matches yours</p>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-2">
        {hairstyles.map((style) => (
          <Card
            key={style.id}
            className={cn(
              "cursor-pointer transition-all duration-300 hover:shadow-md",
              selectedHairstyle === style.id 
                ? "ring-2 ring-primary shadow-md bg-primary/5" 
                : "hover:shadow-sm"
            )}
            onClick={() => onSelect(style.id, style.avatar_id, style.scaling_factor, style.image_url)}
          >
            <CardContent className="p-2">
              <div className="aspect-square relative mb-1 overflow-hidden rounded-lg flex items-center justify-center">
                <img
                  src={style.image_url}
                  alt={style.name}
                  className="w-3/4 h-3/4 object-contain"
                />
                {selectedHairstyle === style.id && (
                  <div className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                    <Check className="w-2 h-2 text-primary-foreground" />
                  </div>
                )}
              </div>
              <p className="text-xs font-medium text-center">{style.name}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
} 