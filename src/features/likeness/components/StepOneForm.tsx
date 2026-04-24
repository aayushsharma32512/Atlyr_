import { UseFormReturn } from 'react-hook-form';
import { CardHeader, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, RotateCcw, Info, ChevronLeft } from 'lucide-react';
import { Form, FormField, FormItem, FormControl } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import type { LikenessFormData } from "../types"
import { useRef, useState } from 'react';

const FULL_BODY_INFO = `Neutral Pose. Stand facing the camera, arms slightly away from your sides. Your full silhouette, head to toe should be visible. Preferably, with fitted clothing.`

const FACE_SELFIE_INFO = `Look into the camera; face centred in frame. A close-up from chin to crown works best. Natural, even lighting; avoid strong backlighting or shadows across your face.`

interface StepOneFormProps {
  type: 'drawer' | 'screen';
  form: UseFormReturn<LikenessFormData>;
  onGenerate: () => Promise<void> | void;
  showBack?: boolean
  onBack?: () => void
  isBackDisabled?: boolean
}

export function StepOneForm({
  type,
  form,
  onGenerate,
  showBack = false,
  onBack,
  isBackDisabled = false,
}: StepOneFormProps) {
  const fullBodyInputRef = useRef<HTMLInputElement>(null);
  const faceSelfieInputRef = useRef<HTMLInputElement>(null);
  const [showFullBodyInfo, setShowFullBodyInfo] = useState(false);
  const [showFaceSelfieInfo, setShowFaceSelfieInfo] = useState(false);

  const handleFullBodyClick = () => {
    fullBodyInputRef.current?.click();
  };

  const handleFaceSelfieClick = () => {
    faceSelfieInputRef.current?.click();
  };

  const handleFileChange = (field: 'fullBodyPhoto' | 'faceSelfiePhoto', file: File | null) => {
    form.setValue(field, file);
  };

  const fullBodyPhoto = form.watch('fullBodyPhoto');
  const faceSelfiePhoto = form.watch('faceSelfiePhoto');

  const handleGenerate = async () => {
    const isValid = await form.trigger(['fullBodyPhoto', 'faceSelfiePhoto']);
    if (isValid) {
      await onGenerate();
    }
  };

  return (
    <Form {...form}>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <CardHeader className={`flex gap-3 items-center justify-center p-6 shrink-0 ${type === 'drawer' ? 'border-none shadow-none' : ''}`}>
            <div className={`flex flex-1 flex-col gap-1.5 items-center justify-center text-center ${type === 'drawer' ? 'border-none' : ''}`}>
              <p className="text-base font-medium text-card-foreground leading-none">
                Generate User Avatar
              </p>
              <p className="text-sm font-normal text-muted-foreground leading-5">
                Upload a full body photo and a selfie
              </p>
            </div>
          </CardHeader>

          <div className={`flex gap-4 items-center justify-center px-4 py-4 w-full ${type === 'drawer' ? 'pt-2' : ''}`}>
            {/* Full Body Photo Upload */}
            <div className="flex flex-col gap-3 items-center relative w-full max-w-[210px]">
              <div className="relative w-full aspect-[2/3] bg-muted rounded-[10px] overflow-hidden">
                {fullBodyPhoto ? (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <img
                        src={URL.createObjectURL(fullBodyPhoto)}
                        alt="Full body preview"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleFullBodyClick}
                      className="absolute bottom-0 inset-x-0 flex flex-col gap-1 items-center justify-center py-2.5 bg-black/40 hover:bg-black/55 transition-colors"
                    >
                      <RotateCcw className="size-4 text-white" />
                      <span className="text-xs font-medium text-white">Try another?</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleFullBodyClick}
                    className="absolute inset-0 flex flex-col gap-1.5 items-center justify-center bg-muted hover:bg-muted/80 transition-colors rounded-[10px]"
                  >
                    <Plus className="size-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">full body</span>
                  </button>
                )}
                {/* Info trigger — visible in both states */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowFullBodyInfo(true); }}
                  className="absolute top-2 right-2 z-10 flex items-center justify-center text-muted-foreground"
                  aria-label="Full body photo guidelines"
                >
                  <Info className="size-4" />
                </button>
                {/* Info overlay */}
                {showFullBodyInfo && (
                  <div className="absolute inset-0 z-20 bg-muted rounded-[10px]">
                    <button
                      type="button"
                      onClick={() => setShowFullBodyInfo(false)}
                      className="absolute top-2 left-2 z-10 flex items-center gap-0.5 text-xs text-muted-foreground"
                      aria-label="Back to upload"
                    >
                      <ChevronLeft className="size-3" />
                      <span>back</span>
                    </button>
                    <div className="absolute inset-0 overflow-y-auto pt-8 px-3 pb-3">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {FULL_BODY_INFO}
                      </p>
                    </div>
                  </div>
                )}
                <input
                  ref={fullBodyInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    handleFileChange('fullBodyPhoto', file);
                  }}
                />
              </div>
            </div>

            {/* Face Selfie Photo Upload */}
            <div className="flex flex-col gap-3 items-center relative w-full max-w-[210px]">
              <div className="relative w-full aspect-[2/3] bg-muted rounded-[10px] overflow-hidden">
                {faceSelfiePhoto ? (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <img
                        src={URL.createObjectURL(faceSelfiePhoto)}
                        alt="Face selfie preview"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleFaceSelfieClick}
                      className="absolute bottom-0 inset-x-0 flex flex-col gap-1 items-center justify-center py-2.5 bg-black/40 hover:bg-black/55 transition-colors"
                    >
                      <RotateCcw className="size-4 text-white" />
                      <span className="text-xs font-medium text-white">Try another?</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleFaceSelfieClick}
                    className="absolute inset-0 flex flex-col gap-1.5 items-center justify-center bg-muted hover:bg-muted/80 transition-colors rounded-[10px]"
                  >
                    <Plus className="size-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">face selfie</span>
                  </button>
                )}
                {/* Info trigger — visible in both states */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowFaceSelfieInfo(true); }}
                  className="absolute top-2 right-2 z-10 flex items-center justify-center text-muted-foreground"
                  aria-label="Face selfie photo guidelines"
                >
                  <Info className="size-4" />
                </button>
                {/* Info overlay */}
                {showFaceSelfieInfo && (
                  <div className="absolute inset-0 z-20 bg-muted rounded-[10px]">
                    <button
                      type="button"
                      onClick={() => setShowFaceSelfieInfo(false)}
                      className="absolute top-2 left-2 z-10 flex items-center gap-0.5 text-xs text-muted-foreground"
                      aria-label="Back to upload"
                    >
                      <ChevronLeft className="size-3" />
                      <span>back</span>
                    </button>
                    <div className="absolute inset-0 overflow-y-auto pt-8 px-3 pb-3">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {FACE_SELFIE_INFO}
                      </p>
                    </div>
                  </div>
                )}
                <input
                  ref={faceSelfieInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    handleFileChange('faceSelfiePhoto', file);
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <CardFooter className={`flex flex-col gap-2 items-center justify-center pb-6 pt-4 px-4 shrink-0 ${type === 'drawer' ? 'border-none shadow-none' : ''}`}>
          {showBack ? (
            <div className="flex w-full gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onBack} disabled={isBackDisabled}>
                back
              </Button>
              <Button
                type="button"
                onClick={handleGenerate}
                className="bg-primary flex gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm flex-1"
                disabled={!fullBodyPhoto || !faceSelfiePhoto}
              >
                <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">
                  Generate
                </p>
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={handleGenerate}
              className="bg-primary flex gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm w-full"
              disabled={!fullBodyPhoto || !faceSelfiePhoto}
            >
              <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">
                Generate
              </p>
            </Button>
          )}
        </CardFooter>
      </div>
    </Form>
  );
}

