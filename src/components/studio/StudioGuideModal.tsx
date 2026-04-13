import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  Info, 
  Sparkles
} from 'lucide-react';

interface StudioGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTutorial: () => void;
}

export function StudioGuideModal({ isOpen, onClose, onStartTutorial }: StudioGuideModalProps) {
  const handleStartTutorial = () => {
    onStartTutorial();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Info className="w-5 h-5 text-primary" />
            <span>Studio Tutorial</span>
          </DialogTitle>
          <DialogDescription>
            Learn how to use Studio features with an interactive tutorial
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">Interactive Tutorial</h3>
              <p className="text-sm text-muted-foreground">
                Take a guided tour of Studio features. Learn how to customize outfits, 
                browse alternatives, and share your creations.
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <Button onClick={handleStartTutorial} className="w-full">
              Start Tutorial
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 