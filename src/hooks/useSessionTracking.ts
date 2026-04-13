import { useState, useEffect, useRef, useCallback } from 'react';
import { logInteraction, INTERACTION_WEIGHTS } from '@/utils/interactionLogger';

interface SessionData {
  appStartTime: number;
  totalAppTime: number;
  totalStudioTime: number;
  currentStudioStart: number | null;
  currentOutfitId: string | null;
  isActive: boolean;
  lastActiveTime: number;
}

export function useSessionTracking() {
  const [sessionData, setSessionData] = useState<SessionData>({
    appStartTime: Date.now(),
    totalAppTime: 0,
    totalStudioTime: 0,
    currentStudioStart: null,
    currentOutfitId: null,
    isActive: true,
    lastActiveTime: Date.now()
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Update app session every 30 seconds
  useEffect(() => {
    const updateAppSession = () => {
      const now = Date.now();
      setSessionData(prev => {
        if (prev.isActive) {
          const newTotalTime = prev.totalAppTime + (now - prev.lastActiveTime);
          return {
            ...prev,
            totalAppTime: newTotalTime,
            lastActiveTime: now
          };
        }
        return { ...prev, lastActiveTime: now };
      });
    };

    intervalRef.current = setInterval(updateAppSession, 30000); // Update every 30 seconds

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Track user activity
  useEffect(() => {
    const handleActivity = () => {
      setSessionData(prev => ({ ...prev, isActive: true, lastActiveTime: Date.now() }));
    };

    const handleInactivity = () => {
      setSessionData(prev => ({ ...prev, isActive: false }));
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleInactivity();
      } else {
        handleActivity();
      }
    };

    // Listen for user activity
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('scroll', handleActivity);

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Enter studio session
  const enterStudio = (outfitId: string, category: string) => {
    setSessionData(prev => ({
      ...prev,
      currentStudioStart: Date.now(),
      currentOutfitId: outfitId
    }));
  };

  // Exit studio session
  const exitStudio = (category: string) => {
    setSessionData(prev => {
      if (prev.currentStudioStart && prev.currentOutfitId) {
        const sessionDuration = Date.now() - prev.currentStudioStart;
        const newTotalStudioTime = prev.totalStudioTime + sessionDuration;
        
        // Log studio session
        logInteraction(
          'studio_time',
          prev.currentOutfitId,
          category,
          INTERACTION_WEIGHTS.studio_time,
          {
            session_duration: sessionDuration,
            total_studio_time: newTotalStudioTime,
            total_app_time: prev.totalAppTime,
            studio_percentage: prev.totalAppTime > 0 ? (newTotalStudioTime / prev.totalAppTime) * 100 : 0
          }
        );

        return {
          ...prev,
          totalStudioTime: newTotalStudioTime,
          currentStudioStart: null,
          currentOutfitId: null
        };
      }
      return prev;
    });
  };

  // Get current session stats
  const getSessionStats = useCallback(() => {
    const now = Date.now();
    const currentAppTime = sessionData.isActive 
      ? sessionData.totalAppTime + (now - sessionData.lastActiveTime)
      : sessionData.totalAppTime;
    
    return {
      totalAppTime: currentAppTime,
      totalStudioTime: sessionData.totalStudioTime,
      studioPercentage: currentAppTime > 0 ? (sessionData.totalStudioTime / currentAppTime) * 100 : 0,
      currentStudioSession: sessionData.currentStudioStart 
        ? now - sessionData.currentStudioStart 
        : 0
    };
  }, [sessionData]);

  return {
    enterStudio,
    exitStudio,
    getSessionStats,
    sessionData
  };
} 