import { useState, useEffect } from 'react';

interface TutorialState {
  hasSeenGuide: boolean;
  hasCompletedTutorial: boolean;
  isFirstTime: boolean;
}

export function useStudioTutorial() {
  const [tutorialState, setTutorialState] = useState<TutorialState>({
    hasSeenGuide: false,
    hasCompletedTutorial: false,
    isFirstTime: true
  });
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Load tutorial state from localStorage
  useEffect(() => {
    const savedState = localStorage.getItem('studio-tutorial-state');
    if (savedState) {
      const parsed = JSON.parse(savedState);
      setTutorialState(parsed);
    }
  }, []);

  // Save tutorial state to localStorage
  const saveTutorialState = (newState: Partial<TutorialState>) => {
    const updatedState = { ...tutorialState, ...newState };
    setTutorialState(updatedState);
    localStorage.setItem('studio-tutorial-state', JSON.stringify(updatedState));
  };

  // Check if user should see guide on first visit
  useEffect(() => {
    if (tutorialState.isFirstTime && !tutorialState.hasSeenGuide) {
      // Small delay to ensure page is loaded
      const timer = setTimeout(() => {
        setShowGuideModal(true);
        saveTutorialState({ hasSeenGuide: true, isFirstTime: false });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [tutorialState.isFirstTime, tutorialState.hasSeenGuide]);

  const handleStartTutorial = () => {
    setShowTutorial(true);
    setShowGuideModal(false);
  };

  const handleCompleteTutorial = () => {
    setShowTutorial(false);
    saveTutorialState({ hasCompletedTutorial: true });
  };

  const handleSkipTutorial = () => {
    setShowTutorial(false);
    saveTutorialState({ hasCompletedTutorial: true });
  };

  const handleShowGuide = () => {
    // Directly start the interactive tutorial instead of showing the guide modal
    setShowTutorial(true);
  };

  const handleCloseGuide = () => {
    setShowGuideModal(false);
  };

  const resetTutorial = () => {
    localStorage.removeItem('studio-tutorial-state');
    setTutorialState({
      hasSeenGuide: false,
      hasCompletedTutorial: false,
      isFirstTime: true
    });
    setShowGuideModal(false);
    setShowTutorial(false);
  };

  return {
    tutorialState,
    showGuideModal,
    showTutorial,
    handleStartTutorial,
    handleCompleteTutorial,
    handleSkipTutorial,
    handleShowGuide,
    handleCloseGuide,
    resetTutorial
  };
} 