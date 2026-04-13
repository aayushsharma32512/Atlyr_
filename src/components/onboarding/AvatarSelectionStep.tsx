import { motion } from 'framer-motion';
import { FaceShapeSelector } from './FaceShapeSelector';
import { SkinToneSelector } from './SkinToneSelector';
import { HairstyleSelector } from './HairstyleSelector';

interface AvatarSelectionStepProps {
  avatarStep: 'face-shape' | 'skin-tone' | 'hairstyle';
  formData: {
    gender: string;
    selectedFaceShape: string;
    selectedSkinTone: string;
    selectedHairstyle: string;
  };
  onUpdateFormData: (updates: any) => void;
}

export function AvatarSelectionStep({ 
  avatarStep, 
  formData, 
  onUpdateFormData 
}: AvatarSelectionStepProps) {
  return (
    <motion.div 
      key={avatarStep}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="space-y-6"
    >
      {avatarStep === 'face-shape' && (
        <FaceShapeSelector
          gender={formData.gender}
          onSelect={(faceShape) => {
            onUpdateFormData({ selectedFaceShape: faceShape });
          }}
          selectedFaceShape={formData.selectedFaceShape}
        />
      )}
      
      {avatarStep === 'skin-tone' && (
        <SkinToneSelector
          gender={formData.gender}
          faceShape={formData.selectedFaceShape}
          onSelect={(skinTone) => onUpdateFormData({ selectedSkinTone: skinTone })}
          selectedSkinTone={formData.selectedSkinTone}
        />
      )}
      
      {avatarStep === 'hairstyle' && (
        <HairstyleSelector
          gender={formData.gender}
          faceShape={formData.selectedFaceShape}
          skinTone={formData.selectedSkinTone}
          onSelect={(hairstyle, avatarId, scalingFactor, imageUrl) => 
            onUpdateFormData({ 
              selectedHairstyle: hairstyle,
              selectedAvatarId: avatarId,
              selectedAvatarImageUrl: imageUrl,
              selectedAvatarScalingFactor: scalingFactor
            })
          }
          selectedHairstyle={formData.selectedHairstyle}
        />
      )}
    </motion.div>
  );
}