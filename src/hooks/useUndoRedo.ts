import { useState, useCallback, useEffect } from 'react';
import { Outfit, ItemType } from '@/types';
import { OutfitHistoryEntry } from './useStudioSession';

const MAX_HISTORY_SIZE = 7;

interface UseUndoRedoProps {
  currentOutfit: Outfit;
  session: any; // StudioSession type from useStudioSession
  onOutfitChange: (outfit: Outfit) => void;
  saveSession: (outfit: Outfit, currentOutfit: Outfit, originalOutfit: Outfit, backgroundId?: string, undoStack?: OutfitHistoryEntry[], redoStack?: OutfitHistoryEntry[]) => void;
}

export function useUndoRedo({ currentOutfit, session, onOutfitChange, saveSession }: UseUndoRedoProps) {
  const [undoStack, setUndoStack] = useState<OutfitHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<OutfitHistoryEntry[]>([]);

  // Initialize stacks from session on mount
  useEffect(() => {
    if (session) {
      setUndoStack(session.undoStack || []);
      setRedoStack(session.redoStack || []);
    }
  }, [session]);

  // Deep clone outfit to prevent reference issues
  const deepCloneOutfit = useCallback((outfit: Outfit): Outfit => {
    return JSON.parse(JSON.stringify(outfit));
  }, []);

  // Save current state to history
  const saveToHistory = useCallback((
    outfit: Outfit,
    changeType: 'item_change' | 'background_change' | 'remix_change',
    changedItemType?: ItemType,
    description?: string
  ) => {
    const historyEntry: OutfitHistoryEntry = {
      outfit: deepCloneOutfit(outfit),
      timestamp: Date.now(),
      changeType,
      changedItemType,
      description: description || `Changed ${changeType}`
    };

    setUndoStack(prevUndoStack => {
      const newUndoStack = [historyEntry, ...prevUndoStack].slice(0, MAX_HISTORY_SIZE);
      
      // Sync with session
      if (session) {
        saveSession(
          session.outfit,
          outfit,
          session.originalOutfit,
          outfit.backgroundId,
          newUndoStack,
          []
        );
      }
      
      return newUndoStack;
    });

    // Clear redo stack when new change is made
    setRedoStack([]);
  }, [deepCloneOutfit, session, saveSession]);

  // Undo operation
  const undo = useCallback(() => {
    if (undoStack.length === 0) return;

    const [latestEntry, ...remainingUndoStack] = undoStack;

    const newRedoStack: OutfitHistoryEntry[] = [
      {
        outfit: deepCloneOutfit(currentOutfit),
        timestamp: Date.now(),
        changeType: 'item_change',
        description: 'Undone change'
      },
      ...redoStack
    ];

    setUndoStack(remainingUndoStack);
    setRedoStack(newRedoStack);

    if (session) {
      saveSession(
        session.outfit,
        latestEntry.outfit,
        session.originalOutfit,
        latestEntry.outfit.backgroundId,
        remainingUndoStack,
        newRedoStack
      );
    }

    onOutfitChange(latestEntry.outfit);
  }, [undoStack, redoStack, currentOutfit, deepCloneOutfit, onOutfitChange, session, saveSession]);

  // Redo operation
  const redo = useCallback(() => {
    if (redoStack.length === 0) return;

    const [latestRedoEntry, ...remainingRedoStack] = redoStack;

    const newUndoStack: OutfitHistoryEntry[] = [
      {
        outfit: deepCloneOutfit(currentOutfit),
        timestamp: Date.now(),
        changeType: 'item_change',
        description: 'Redone change'
      },
      ...undoStack
    ];

    setUndoStack(newUndoStack);
    setRedoStack(remainingRedoStack);

    if (session) {
      saveSession(
        session.outfit,
        latestRedoEntry.outfit,
        session.originalOutfit,
        latestRedoEntry.outfit.backgroundId,
        newUndoStack,
        remainingRedoStack
      );
    }

    onOutfitChange(latestRedoEntry.outfit);
  }, [redoStack, undoStack, currentOutfit, deepCloneOutfit, onOutfitChange, session, saveSession]);

  // Check if undo/redo are available
  const canUndo = useCallback(() => undoStack.length > 0, [undoStack]);
  const canRedo = useCallback(() => redoStack.length > 0, [redoStack]);

  // Clear history
  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  // Get history info for UI
  const getHistoryInfo = useCallback(() => ({
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    canUndo: canUndo(),
    canRedo: canRedo(),
    nextUndoDescription: undoStack[0]?.description || '',
    nextRedoDescription: redoStack[0]?.description || ''
  }), [undoStack, redoStack, canUndo, canRedo]);

  return {
    saveToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    getHistoryInfo,
    undoStack,
    redoStack
  };
}
