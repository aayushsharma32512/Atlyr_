import { UseFormReturn } from 'react-hook-form';
import { CardHeader, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, RotateCcw, Info, ChevronLeft } from 'lucide-react';
import { Form, FormField, FormItem, FormControl } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import type { LikenessFormData } from "../types"
import { cn } from '@/lib/utils';
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
  isSaving?: boolean
  /**
   * Canvas 6n's "Not now — keep browsing". Drawer only: this is the one time
   * the app interrupts you, so the exit has to be visible and has to put you
   * back exactly where you were. On the settings screen there is nothing to
   * return to, so it isn't rendered there.
   */
  onDismiss?: () => void
}

export function StepOneForm({
  type,
  form,
  onGenerate,
  showBack = false,
  onBack,
  isBackDisabled = false,
  isSaving = false,
  onDismiss,
}: StepOneFormProps) {
  const isDrawer = type === 'drawer'
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
          {isDrawer ? (
            /* Canvas 6n. The old copy ("Generate User Avatar / Upload a full
               body photo and a selfie") described the mechanism; this describes
               the bargain — two photos once, instant try-ons forever — which is
               the only thing that makes an interruption worth accepting. */
            <div className="shrink-0 px-5 pt-1">
              <p className="text-[8.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                One-time setup
              </p>
              <h2 className="mt-2 font-display text-[26px] font-medium leading-[1.15] text-foreground">
                Meet yourself,
                <br />
                in the clothes.
              </h2>
              <p className="mt-2 max-w-[280px] text-[10px] leading-[1.5] text-muted-foreground">
                Two photos, once. We build your likeness and reuse it forever — every try-on after
                this is instant.
              </p>
            </div>
          ) : (
            <CardHeader className="flex gap-3 items-center justify-center p-6 shrink-0">
              <div className="flex flex-1 flex-col gap-1.5 items-center justify-center text-center">
                <p className="text-base font-medium text-card-foreground leading-none">
                  Generate User Avatar
                </p>
                <p className="text-sm font-normal text-muted-foreground leading-5">
                  Upload a full body photo and a selfie
                </p>
              </div>
            </CardHeader>
          )}

          <div
            className={cn(
              'w-full',
              isDrawer
                ? 'grid grid-cols-2 gap-2 px-5 pt-4'
                : 'flex gap-4 items-center justify-center px-4 py-4',
            )}
          >
            {/* Full Body Photo Upload */}
            <div
              className={cn(
                'relative flex w-full flex-col',
                isDrawer ? '' : 'gap-3 items-center max-w-[210px]',
              )}
            >
              <div
                className={cn(
                  'relative w-full overflow-hidden',
                  isDrawer
                    ? cn('rounded-[5px] border border-hairline bg-card', fullBodyPhoto ? 'aspect-[3/4]' : 'h-[86px]')
                    : 'aspect-[2/3] bg-muted rounded-[10px]',
                )}
              >
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
                ) : isDrawer ? (
                  <button
                    type="button"
                    onClick={handleFullBodyClick}
                    className="absolute inset-0 flex flex-col items-start justify-center gap-1 px-3 text-left transition-colors hover:bg-muted/30"
                  >
                    <span className="flex size-[22px] items-center justify-center rounded-full bg-ink text-[8px] font-bold text-on-ink-1">
                      01
                    </span>
                    <span className="text-[11px] font-semibold leading-none text-foreground">Full body</span>
                    <span className="text-[8px] leading-none text-muted-foreground">standing, head to toe</span>
                  </button>
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
            <div
              className={cn(
                'relative flex w-full flex-col',
                isDrawer ? '' : 'gap-3 items-center max-w-[210px]',
              )}
            >
              <div
                className={cn(
                  'relative w-full overflow-hidden',
                  isDrawer
                    ? cn('rounded-[5px] border border-hairline bg-card', faceSelfiePhoto ? 'aspect-[3/4]' : 'h-[86px]')
                    : 'aspect-[2/3] bg-muted rounded-[10px]',
                )}
              >
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
                ) : isDrawer ? (
                  <button
                    type="button"
                    onClick={handleFaceSelfieClick}
                    className="absolute inset-0 flex flex-col items-start justify-center gap-1 px-3 text-left transition-colors hover:bg-muted/30"
                  >
                    <span className="flex size-[22px] items-center justify-center rounded-full bg-ink text-[8px] font-bold text-on-ink-1">
                      02
                    </span>
                    <span className="text-[11px] font-semibold leading-none text-foreground">Selfie</span>
                    <span className="text-[8px] leading-none text-muted-foreground">clear face, good light</span>
                  </button>
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
                disabled={!fullBodyPhoto || !faceSelfiePhoto || isSaving}
              >
                <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">
                  {isSaving ? 'Generating...' : 'Generate'}
                </p>
              </Button>
            </div>
          ) : isDrawer ? (
            <>
              <Button
                type="button"
                onClick={handleGenerate}
                className="flex h-11 w-full items-center justify-center rounded-[3px] bg-primary px-4 shadow-sm"
                disabled={!fullBodyPhoto || !faceSelfiePhoto || isSaving}
              >
                <span className="text-[12px] font-bold text-primary-foreground">
                  {isSaving ? 'Building…' : 'Build my likeness'}
                </span>
              </Button>
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={isSaving}
                  className="text-[10px] font-medium text-muted-foreground disabled:opacity-50"
                >
                  Not now — keep browsing
                </button>
              )}
            </>
          ) : (
            <Button
              type="button"
              onClick={handleGenerate}
              className="bg-primary flex gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm w-full"
              disabled={!fullBodyPhoto || !faceSelfiePhoto || isSaving}
            >
              <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">
                {isSaving ? 'Generating...' : 'Generate'}
              </p>
            </Button>
          )}
        </CardFooter>
      </div>
    </Form>
  );
}

