import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  MousePointer, 
  Check, 
  X, 
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Lightbulb,
  Target,
  Eye,
  RefreshCw,
  Share,
  Brackets,
  Bookmark,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  target: string; // CSS selector for the element to highlight
  position: 'top' | 'bottom' | 'left' | 'right';
  action?: 'click' | 'hover' | 'observe';
  tip?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface StudioTutorialProps {
  isActive: boolean;
  onComplete: () => void;
  onSkip: () => void;
  onCloseAlternatives?: () => void;
}

export function StudioTutorial({ isActive, onComplete, onSkip, onCloseAlternatives }: StudioTutorialProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [waitingForAlternatives, setWaitingForAlternatives] = useState(false);

  const tutorialSteps: TutorialStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to Studio!',
      description: 'Let\'s take a comprehensive tour of Studio features. I\'ll guide you through each step to help you create amazing outfits.',
      target: '',
      position: 'bottom',
      action: 'observe',
      tip: 'This tutorial will show you how to use all the Studio features effectively. Follow along to master the interface!',
      icon: Sparkles
    },
    {
      id: 'avatar-interaction',
      title: 'Interactive Avatar',
      description: 'Click on any clothing item (top, bottom, or shoes) to see alternative options and customize your outfit.',
      target: '.dynamic-avatar',
      position: 'top',
      action: 'click',
      tip: 'Try clicking on the shirt, pants, or shoes to open the alternatives panel. This is how you customize your outfit!',
      icon: MousePointer
    },
    {
      id: 'alternatives-panel',
      title: 'Alternatives Panel',
      description: 'This panel shows different options for the selected item. Browse through alternatives and filter by type!',
      target: '.alternatives-panel',
      position: 'left',
      action: 'observe',
      tip: 'Use the dropdown to switch between Alternate Items, Similar Items, Favorites, and Wardrobe items. Each mode shows different options!',
      icon: Eye
    },
    {
      id: 'filter-modes',
      title: 'Filter Modes',
      description: 'Switch between different filter modes to find exactly what you\'re looking for.',
      target: '.alternatives-panel select',
      position: 'left',
      action: 'observe',
      tip: 'Alternate Items show different styles, Similar Items show same style different brands, Favorites show your saved items, and Wardrobe shows your personal collection.',
      icon: Target
    },
    {
      id: 'background-selection',
      title: 'Background Themes',
      description: 'Change the background to set the perfect scene for your outfit.',
      target: '.studio-header',
      position: 'top',
      action: 'observe',
      tip: 'Click the brackets button in the top-right to change backgrounds and create different moods for your outfit.',
      icon: Brackets
    },
    {
      id: 'outfit-details',
      title: 'Outfit Details',
      description: 'Pull up this card to see detailed pricing, item information, and outfit breakdown.',
      target: '.bottom-sheet-handle',
      position: 'top',
      action: 'observe',
      tip: 'You can drag the handle up or click the expand button to see complete outfit details and pricing information.',
      icon: Target
    },
    {
      id: 'remix-feature',
      title: 'Remix Feature',
      description: 'Generate a completely new outfit while maintaining style consistency.',
      target: '.remix-button',
      position: 'bottom',
      action: 'observe',
      tip: 'The remix button creates fresh combinations from the same category, perfect for discovering new styles!',
      icon: RefreshCw
    },
    {
      id: 'share-feature',
      title: 'Share Your Creation',
      description: 'Share your outfit with friends or save it to your collection.',
      target: '.share-button',
      position: 'bottom',
      action: 'observe',
      tip: 'Use the share button to send your outfit to friends or save it to your favorites for later.',
      icon: Share
    },
    {
      id: 'finalize-outfit',
      title: 'Finalize Your Outfit',
      description: 'Use Heart to save privately or Rocket to publish.',
      target: '.publish-button',
      position: 'left',
      action: 'observe',
      tip: 'The right-side action bar has two finalization buttons: Heart for Favorites and Rocket for Publish.',
      icon: Bookmark
    },
    {
      id: 'complete',
      title: 'You\'re All Set!',
      description: 'You now know how to use all the Studio features. Start creating amazing outfits and sharing your style with the world!',
      target: '',
      position: 'top',
      action: 'observe',
      tip: 'Remember, you can always access this tutorial again from the header info button. Happy styling!',
      icon: Sparkles
    }
  ];

  const currentStep = tutorialSteps[currentStepIndex];

  



const cleanupTutorial = () => {
    try {
      // Remove all tutorial highlights
      const highlightedElements = document.querySelectorAll('.tutorial-highlight');
      highlightedElements.forEach(element => {
        element.classList.remove('tutorial-highlight');
      });
      
      // Close alternatives panel if open
      const alternativesPanel = document.querySelector('.alternatives-panel');
      if (alternativesPanel) {
        if (onCloseAlternatives) {
          onCloseAlternatives();
        }
      }
      
      // Clear any active intervals or timeouts
      setWaitingForAlternatives(false);
    } catch (error) {
      console.warn('Error during tutorial cleanup:', error);
    }
  };

  useEffect(() => {
    if (!isActive) return;

    // Clear any existing highlights first
    const existingHighlights = document.querySelectorAll('.tutorial-highlight');
    existingHighlights.forEach(element => {
      element.classList.remove('tutorial-highlight');
    });

    // Small delay to ensure elements are rendered and previous highlights are cleared
    const timer = setTimeout(() => {
      try {
        // Special handling for alternatives panel step
        if (currentStep.id === 'alternatives-panel') {
          // Check if alternatives panel is visible
          const alternativesPanel = document.querySelector('.alternatives-panel');
          if (alternativesPanel) {
            // Add highlight with a small delay for smooth transition
            setTimeout(() => {
              alternativesPanel.classList.add('tutorial-highlight');
              setIsHighlighted(true);
            }, 50);
          } else {
            // If panel is not visible, try to trigger it by clicking an avatar item
            const avatarElement = document.querySelector('.dynamic-avatar img');
            if (avatarElement) {
              (avatarElement as HTMLElement).click();
              // Wait for panel to appear
              const checkPanel = setInterval(() => {
                const panel = document.querySelector('.alternatives-panel');
                if (panel) {
                  clearInterval(checkPanel);
                  setTimeout(() => {
                    panel.classList.add('tutorial-highlight');
                    setIsHighlighted(true);
                  }, 100);
                }
              }, 100);
              // Timeout after 3 seconds
              setTimeout(() => {
                clearInterval(checkPanel);
                if (!document.querySelector('.alternatives-panel')) {
                  handleNext();
                }
              }, 3000);
            } else {
              // If no avatar element found, skip this step
              handleNext();
            }
            return;
          }
        } else {
          // Special handling for complete step (no target element)
          if (currentStep.id === 'complete') {
            // No highlighting needed for complete step
            setIsHighlighted(false);
          } else if (currentStep.target && currentStep.target.trim() !== '') {
            // Highlight the target element - only if target is not empty
            const targetElement = document.querySelector(currentStep.target);
            if (targetElement) {
              // Special check for action buttons - ensure alternatives panel is closed
              if (currentStep.id === 'action-buttons' || currentStep.id === 'outfit-details') {
                const alternativesPanel = document.querySelector('.alternatives-panel');
                if (alternativesPanel && !alternativesPanel.classList.contains('translate-x-full')) {
                  // Panel is still open, close it first
                  if (onCloseAlternatives) {
                    onCloseAlternatives();
                  }
                  // Wait a bit before highlighting
                  setTimeout(() => {
                    targetElement.classList.add('tutorial-highlight');
                    setIsHighlighted(true);
                  }, 300);
                  return;
                }
              }
              
              // Add highlight with a small delay for smooth transition
              setTimeout(() => {
                targetElement.classList.add('tutorial-highlight');
                setIsHighlighted(true);
              }, 50);
              
              // Add click handler for interactive steps
              if (currentStep.action === 'click') {
                const clickHandler = () => {
                  // Special handling for avatar interaction
                  if (currentStep.id === 'avatar-interaction') {
                    setWaitingForAlternatives(true);
                    // Wait for alternatives panel to appear
                    const checkAlternatives = setInterval(() => {
                      const panel = document.querySelector('.alternatives-panel');
                      if (panel && !panel.classList.contains('translate-x-full')) {
                        clearInterval(checkAlternatives);
                        setWaitingForAlternatives(false);
                        // Wait 1.5 seconds before moving to next step
                        setTimeout(() => handleNext(), 1500);
                      }
                    }, 100);
                    
                    // Timeout after 3 seconds
                    setTimeout(() => {
                      clearInterval(checkAlternatives);
                      setWaitingForAlternatives(false);
                      handleNext();
                    }, 3000);
                  } else {
                    setTimeout(() => handleNext(), 200);
                  }
                };
                targetElement.addEventListener('click', clickHandler);
                
                // Store the handler for cleanup
                (targetElement as any)._tutorialClickHandler = clickHandler;
              }
              
              // Scroll element into view if needed
              targetElement.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center',
                inline: 'center'
              });
            }
          }
        }
      } catch (error) {
        console.warn('Error during tutorial step setup:', error);
        // If there's an error, try to move to next step
        setTimeout(() => handleNext(), 1000);
      }
    }, 150); // Increased delay slightly for smoother transitions

    return () => {
      clearTimeout(timer);
      // Clean up highlight - only if target is not empty
      if (currentStep.target && currentStep.target.trim() !== '') {
        const targetElement = document.querySelector(currentStep.target);
        if (targetElement) {
          targetElement.classList.remove('tutorial-highlight');
          
          // Remove click handler if it exists
          if ((targetElement as any)._tutorialClickHandler) {
            targetElement.removeEventListener('click', (targetElement as any)._tutorialClickHandler);
            delete (targetElement as any)._tutorialClickHandler;
          }
        }
      }
      
      // Clean up alternatives panel highlight if needed
      if (currentStep.id === 'alternatives-panel') {
        const alternativesPanel = document.querySelector('.alternatives-panel');
        if (alternativesPanel) {
          alternativesPanel.classList.remove('tutorial-highlight');
        }
      }
      
      setIsHighlighted(false);
    };
  }, [currentStep, isActive]);

  // Clean up when tutorial becomes inactive
  useEffect(() => {
    if (!isActive) {
      cleanupTutorial();
    }
  }, [isActive]);

  const handleNext = () => {
    setWaitingForAlternatives(false);
    
    // Special handling for alternatives panel step
    if (currentStep.id === 'alternatives-panel') {
      // Close alternatives panel before moving to next step
      if (onCloseAlternatives) {
        onCloseAlternatives();
      }
      
      // Wait for panel to actually close before moving to next step
      const checkPanelClosed = setInterval(() => {
        const alternativesPanel = document.querySelector('.alternatives-panel');
        if (!alternativesPanel || alternativesPanel.classList.contains('translate-x-full')) {
          clearInterval(checkPanelClosed);
          if (currentStepIndex < tutorialSteps.length - 1) {
            setCurrentStepIndex(currentStepIndex + 1);
          } else {
            cleanupTutorial();
            setTimeout(() => onComplete(), 100);
          }
        }
      }, 50);
      
      // Timeout after 2 seconds to prevent infinite waiting
      setTimeout(() => {
        clearInterval(checkPanelClosed);
        if (currentStepIndex < tutorialSteps.length - 1) {
          setCurrentStepIndex(currentStepIndex + 1);
        } else {
          cleanupTutorial();
          setTimeout(() => onComplete(), 100);
        }
      }, 2000);
      
      return;
    }
    
    // Close any open elements before moving to next step
    closeOpenElements();
    
    if (currentStepIndex < tutorialSteps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      // Clean up all tutorial-related elements before completing
      cleanupTutorial();
      // Small delay to ensure cleanup is complete
      setTimeout(() => onComplete(), 100);
    }
  };

  const closeOpenElements = () => {
    // Don't close alternatives panel if we're currently on the alternatives panel step
    if (currentStep.id === 'alternatives-panel') {
      return new Promise<void>(resolve => setTimeout(resolve, 100));
    }
    
    // Close alternatives panel if open
    const alternativesPanel = document.querySelector('.alternatives-panel');
    if (alternativesPanel) {
      // Use the provided close function if available
      if (onCloseAlternatives) {
        onCloseAlternatives();
      } else {
        // Fallback: Find and click the close button (X) in the alternatives panel header
        const closeButton = alternativesPanel.querySelector('button[onClick], button:has(svg[class*="w-4 h-4"])');
        if (closeButton) {
          (closeButton as HTMLElement).click();
        }
      }
      
      // Wait for panel to actually close
      return new Promise<void>(resolve => {
        const checkPanelClosed = setInterval(() => {
          const panel = document.querySelector('.alternatives-panel');
          if (!panel || panel.classList.contains('translate-x-full')) {
            clearInterval(checkPanelClosed);
            setTimeout(() => resolve(), 100);
          }
        }, 50);
        
        // Timeout after 1 second
        setTimeout(() => {
          clearInterval(checkPanelClosed);
          resolve();
        }, 1000);
      });
    }
    
    // Small delay to ensure elements are closed
    return new Promise<void>(resolve => setTimeout(resolve, 300));
  };

  const handleTargetClick = () => {
    // If the current step requires a click action, simulate it
    if (currentStep.action === 'click' && currentStep.target && currentStep.target.trim() !== '') {
      const targetElement = document.querySelector(currentStep.target);
      if (targetElement) {
        // Trigger a click on the target element
        (targetElement as HTMLElement).click();
        
        // Special handling for avatar interaction
        if (currentStep.id === 'avatar-interaction') {
          setWaitingForAlternatives(true);
          // Wait for alternatives panel to appear
          const checkAlternatives = setInterval(() => {
            const panel = document.querySelector('.alternatives-panel');
            if (panel) {
              clearInterval(checkAlternatives);
              setWaitingForAlternatives(false);
              // Wait 3 seconds before moving to next step to let user see the panel
              setTimeout(() => handleNext(), 3000);
            }
          }, 100);
          
          // Timeout after 5 seconds
          setTimeout(() => {
            clearInterval(checkAlternatives);
            setWaitingForAlternatives(false);
            handleNext();
          }, 5000);
          return;
        }
        

      }
    }
    // Move to next step
    handleNext();
  };

  const handlePrevious = () => {
    setWaitingForAlternatives(false);
    
    // Special handling when going back to alternatives panel step
    if (currentStepIndex > 0) {
      const nextStep = tutorialSteps[currentStepIndex - 1];
      if (nextStep.id === 'alternatives-panel') {
        // We're going back to alternatives panel step, but the panel might not be visible
        // We need to trigger the avatar interaction first
        const avatarStep = tutorialSteps.find(step => step.id === 'avatar-interaction');
        if (avatarStep) {
          // Simulate clicking an avatar item to open the panel
          const avatarElement = document.querySelector(avatarStep.target);
          if (avatarElement) {
            (avatarElement as HTMLElement).click();
            // Wait for panel to appear, then move to alternatives step
            setTimeout(() => {
              setCurrentStepIndex(currentStepIndex - 1);
            }, 500);
            return;
          }
        }
      }
    }
    
    // Close any open elements before moving to previous step
    closeOpenElements();
    
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleSkip = () => {
    cleanupTutorial();
    // Small delay to ensure cleanup is complete
    setTimeout(() => onSkip(), 100);
  };

  if (!isActive) return null;

  return (
    <>
      {/* Enhanced Tutorial Overlay - No blur effect */}
      <div className="fixed inset-0 bg-black/20 z-[900] pointer-events-none" />
      
      {/* Enhanced Tutorial Card - Always centered */}
      <Card className={cn(
        "fixed z-[1000] max-w-sm tutorial-card pointer-events-auto bg-background border shadow-2xl",
        "top-1/2 left-1/2 animate-scale-in"
      )}>
        <CardContent className="p-6">
        {/* Enhanced Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
              {currentStep.icon ? (
                <currentStep.icon className="w-4 h-4 text-primary" />
              ) : (
                <Sparkles className="w-4 h-4 text-primary" />
              )}
            </div>
            <Badge variant="secondary" className="text-xs font-medium">
              {currentStepIndex + 1} of {tutorialSteps.length}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="h-8 w-8 p-0 hover:bg-muted/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 bg-muted/30 rounded-full h-1.5 overflow-hidden">
            <div 
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${((currentStepIndex + 1) / tutorialSteps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Enhanced Content */}
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-foreground mb-2 text-base">
              {currentStep.title}
            </h3>
            <p className="text-sm text-foreground leading-relaxed">
              {currentStep.description}
            </p>
          </div>

          {currentStep.tip && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
              <div className="flex items-start space-x-2">
                <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-xs text-foreground leading-relaxed">
                  <strong className="text-primary font-medium">Tip:</strong> {currentStep.tip}
                </p>
              </div>
            </div>
          )}

          {/* Action Indicator */}
          {currentStep.action === 'click' && !waitingForAlternatives && (
            <div className="flex items-center space-x-2 text-xs text-primary font-medium">
              <MousePointer className="w-3 h-3 animate-pulse" />
              <span>Click the highlighted element to try it</span>
            </div>
          )}
          

          
          {waitingForAlternatives && (
            <div className="flex items-center space-x-2 text-xs text-primary font-medium">
              <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span>Opening alternatives panel... (will auto-advance in 2 seconds)</span>
            </div>
          )}
          

        </div>

        {/* Enhanced Navigation */}
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-border/50">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevious}
              disabled={currentStepIndex === 0}
              className="gap-2 text-xs transition-all duration-200 hover:scale-105 disabled:opacity-50"
            >
              <ChevronLeft className="w-3 h-3" />
              Back
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="text-xs text-foreground hover:text-primary transition-colors"
            >
              Skip Tour
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            {currentStepIndex < tutorialSteps.length - 1 ? (
              waitingForAlternatives ? (
                <Button size="sm" disabled className="gap-2 text-xs opacity-75">
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Waiting...
                </Button>
              ) : currentStep.action === 'click' ? (
                <Button 
                  size="sm" 
                  onClick={handleTargetClick} 
                  className="gap-2 text-xs bg-primary hover:bg-primary/90 transition-all duration-200 hover:scale-105"
                >
                  <MousePointer className="w-3 h-3" />
                  Try It
                </Button>
              ) : (
                <Button 
                  size="sm" 
                  onClick={handleNext}
                  className="gap-2 text-xs bg-primary hover:bg-primary/90 transition-all duration-200 hover:scale-105"
                >
                  Next
                  <ChevronRight className="w-3 h-3" />
                </Button>
              )
            ) : (
              <Button 
                size="sm" 
                onClick={handleNext}
                className="gap-2 text-xs bg-primary hover:bg-primary/90 transition-all duration-200 hover:scale-105"
              >
                <Check className="w-3 h-3" />
                Complete
              </Button>
            )}
          </div>
        </div>
        </CardContent>
      </Card>



      {/* Progress Indicator */}
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
        <div className="flex items-center space-x-2 bg-background border border-border rounded-full px-4 py-2 shadow-lg">
          <Sparkles className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-sm font-medium text-foreground">Tutorial</span>
          <div className="flex space-x-1">
            {tutorialSteps.map((_, index) => (
              <div
                key={index}
                className={cn(
                  "w-2 h-2 rounded-full transition-all duration-300",
                  index < currentStepIndex 
                    ? "bg-primary" 
                    : index === currentStepIndex
                    ? "bg-primary animate-pulse"
                    : "bg-muted"
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// Add CSS for tutorial highlights
const tutorialStyles = `
  .tutorial-highlight {
    position: relative;
    z-index: 60;
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4), 0 0 0 8px rgba(59, 130, 246, 0.15);
    border-radius: 8px;
    animation: tutorial-pulse 2.5s infinite ease-in-out;
    transition: all 0.2s ease-in-out;
  }



  @keyframes tutorial-pulse {
    0%, 100% {
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4), 0 0 0 8px rgba(59, 130, 246, 0.15);
      transform: scale(1);
    }
    50% {
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.6), 0 0 0 8px rgba(59, 130, 246, 0.25);
      transform: scale(1.01);
    }
  }

  .tutorial-highlight:hover {
    transform: scale(1.02);
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.7), 0 0 0 8px rgba(59, 130, 246, 0.3);
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = tutorialStyles;
  document.head.appendChild(style);
} 