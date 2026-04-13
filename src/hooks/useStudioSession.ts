import { useState, useEffect, useCallback } from 'react';
import { Outfit, ItemType } from '@/types';

// New interface for history entries
export interface OutfitHistoryEntry {
  outfit: Outfit; // Complete outfit state
  timestamp: number;
  changeType: 'item_change' | 'background_change' | 'remix_change';
  changedItemType?: ItemType;
  description: string; // Human-readable description
}

// Enhanced session interface with undo/redo support
interface StudioSession {
  outfit: Outfit;
  currentOutfit: Outfit; // Modified outfit state
  originalOutfit: Outfit; // Original outfit from card selection
  backgroundId?: string;
  timestamp: number;
  undoStack: OutfitHistoryEntry[];
  redoStack: OutfitHistoryEntry[];
  // Checkpoint: capture the outfit used to enter Studio
  checkpointOutfit?: Outfit;
  checkpointAt?: number;
}

const SESSION_KEY = 'studio_session';
const MAX_HISTORY_SIZE = 7;

export function useStudioSession() {
  const [session, setSession] = useState<StudioSession | null>(null);

  // Load session from storage on mount
  useEffect(() => {
    const storedSession = sessionStorage.getItem(SESSION_KEY);
    if (storedSession) {
      try {
        const parsedSession = JSON.parse(storedSession);
        // Check if session is not too old (24 hours)
        const isExpired = Date.now() - parsedSession.timestamp > 24 * 60 * 60 * 1000;
        if (!isExpired) {
          // Handle migration from old session format (without undo/redo stacks)
          if (!parsedSession.undoStack) {
            parsedSession.undoStack = [];
          }
          if (!parsedSession.redoStack) {
            parsedSession.redoStack = [];
          }
          // Migration: add checkpoint fields if missing
          if (!parsedSession.checkpointOutfit) {
            parsedSession.checkpointOutfit = parsedSession.originalOutfit || parsedSession.outfit;
            parsedSession.checkpointAt = parsedSession.timestamp;
          }
          setSession(parsedSession);
        } else {
          // Clear expired session
          sessionStorage.removeItem(SESSION_KEY);
        }
      } catch (error) {
        console.error('Error parsing studio session:', error);
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
  }, []);

  const saveSession = useCallback((outfit: Outfit, currentOutfit: Outfit, originalOutfit: Outfit, backgroundId?: string, undoStack?: OutfitHistoryEntry[], redoStack?: OutfitHistoryEntry[]) => {
    setSession(prevSession => {
      // Determine whether to set or retain checkpoint
      const isNewEntry = !prevSession || prevSession.outfit?.id !== outfit.id;
      const checkpointOutfit: Outfit | undefined = isNewEntry
        ? outfit
        : prevSession?.checkpointOutfit;
      const checkpointAt: number | undefined = isNewEntry
        ? Date.now()
        : prevSession?.checkpointAt;

      const newSession: StudioSession = {
        outfit,
        currentOutfit,
        originalOutfit,
        backgroundId,
        timestamp: Date.now(),
        undoStack: undoStack || prevSession?.undoStack || [],
        redoStack: redoStack || prevSession?.redoStack || [],
        checkpointOutfit,
        checkpointAt
      };
      
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
      } catch (error) {
        console.error('Error saving studio session:', error);
      }
      
      return newSession;
    });
  }, []);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
  }, []);

  const hasSession = useCallback(() => {
    return session !== null;
  }, [session]);

  return {
    session,
    saveSession,
    clearSession,
    hasSession
  };
} 