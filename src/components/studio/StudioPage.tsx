import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronLeft, Share, RefreshCw, Brackets, GitCompare, Undo2, Redo2, Heart, Rocket, Plus, X, Sparkles, ChevronRight, Layers, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Outfit, OutfitItem } from '@/types';
import { ItemCard } from './ItemCard';
import { AlternativesList } from './AlternativesList';
import { DynamicAvatar } from './DynamicAvatar';
import { useOutfits } from '@/hooks/useOutfits';
import { useFavorites } from '@/hooks/useFavorites';
import { useGuest } from '@/contexts/GuestContext';
import { cn } from '@/lib/utils';
import { useProfile } from '@/hooks/useProfile';
import { useCategories } from '@/hooks/useCategories';
// Removed local background service - now using database occasions
import { Occasion } from '@/types';
import { logInteraction, INTERACTION_WEIGHTS } from '@/utils/interactionLogger';
import { formatCurrency, STUDIO_CONFIG } from '@/utils/constants';
import { StudioHeader } from './StudioHeader';
import { OutfitDetails } from './OutfitDetails';
import { useStudioSession } from '@/hooks/useStudioSession';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/integrations/supabase/client';
import { dataTransformers } from '@/utils/dataTransformers';
import { useVtoFlow } from '@/hooks/useVtoFlow';
import { vtoApi } from '@/utils/vtoApi';
import { useProductImages, preloadProductImages } from '@/hooks/useProductImages';
import { ProductImageCarousel } from '@/components/product/ProductImageCarousel';
import { NeutralPoseManager } from '@/components/vto/NeutralPoseManager';
import { NeutralPoseCandidatesCarousel } from '@/components/vto/NeutralPoseCandidatesCarousel';
import { VtoJobCenter, VtoJob } from './VtoJobCenter';

interface StudioPageProps {
  outfit: Outfit;
  onBack: () => void;
  onOutfitChange?: (outfit: Outfit) => void;
}

type FilterMode = 'alternate' | 'similar' | 'favorites' | 'wardrobe' | 'all';

// Form values used in finalize dialog
type FinalizeFormValues = {
  name: string;
  category: string;
  fit: string;
  feel: string;
  description: string;
  word_association: string[];
};

const LIKENESS_ETA_SECONDS = 50;
const GENERATION_ETA_SECONDS = 30;

const LIKENESS_STAGES = [
  { id: 'upload', label: 'Uploading photos', durationMs: 12000 },
  { id: 'enhance', label: 'Neutralizing pose', durationMs: 12000 },
  { id: 'balance', label: 'Balancing proportions', durationMs: 12000 },
  { id: 'prepare', label: 'Preparing candidates', durationMs: 14000 },
] as const;

const GENERATION_STAGES = [
  { id: 'asset-check', label: 'Gathering your look', durationMs: 8000 },
  { id: 'summaries', label: 'Polishing the details', durationMs: 9000 },
  { id: 'generate', label: 'Bringing it to life', durationMs: 13000 },
] as const;

export function StudioPage({ outfit, onBack, onOutfitChange }: StudioPageProps) {
  const { profile } = useProfile();
  const { guestState } = useGuest();
  const { getAlternativeItems, outfits: allOutfits, addOutfit, refetch: refetchOutfits } = useOutfits();
  const { toggleFavorite, isFavorite, addFavorite } = useFavorites();
  const { categories, loading: categoriesLoading } = useCategories();
  const { toast } = useToast();
  const { session, saveSession } = useStudioSession();

  type CandidatePayload = {
    uploadBatchId: string;
    candidatePaths: string[];
    candidateUrls: string[];
  };

  type GenerationQueueItem = {
    jobId: string;
    topId: string;
    bottomId?: string | null;
    neutralPoseId: string;
    outfitSnapshot: any;
    outfitLabel: string;
    gender: 'male' | 'female' | 'unisex' | null;
  };
  
  // Get original outfit from session or use current outfit as fallback
  const originalOutfit = session?.originalOutfit || outfit;
  const [currentOutfit, setCurrentOutfit] = useState(outfit);
  const [selectedItem, setSelectedItem] = useState<OutfitItem | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [finalizeMode, setFinalizeMode] = useState<'private' | 'public' | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  // Remove finalizeForm and formErrors state
  const [showCompareActions, setShowCompareActions] = useState(false);
  const [isPreviewOriginal, setIsPreviewOriginal] = useState(false);
  const [showVtoSheet, setShowVtoSheet] = useState(false);
  const [vtoSheetMode, setVtoSheetMode] = useState<'likeness' | 'candidates' | null>(null);
  const [candidateJobData, setCandidateJobData] = useState<Record<string, CandidatePayload>>({});
  const [activeCandidateJobId, setActiveCandidateJobId] = useState<string | null>(null);
  const candidateJobIdRef = useRef<string | null>(null);
  const [vtoJobs, setVtoJobs] = useState<VtoJob[]>([]);
  const generationQueueRef = useRef<GenerationQueueItem[]>([]);
  const processingGenerationRef = useRef(false);
  const [processingGenerationJobId, setProcessingGenerationJobId] = useState<string | null>(null);
  const { setStep: setVtoStep, startAssetCheck, computeSummaries, generate, setContext: setVtoContext } = useVtoFlow();

  const addJob = useCallback((job: VtoJob) => {
    setVtoJobs(prev => [...prev, job]);
  }, []);

  const updateJob = useCallback((jobId: string, updates: Partial<VtoJob>) => {
    setVtoJobs(prev => prev.map(job => job.id === jobId ? { ...job, ...updates } : job));
  }, []);

  const removeJob = useCallback((jobId: string) => {
    setVtoJobs(prev => prev.filter(job => job.id !== jobId));
  }, []);

  const runGenerationJob = useCallback(async (queueItem: GenerationQueueItem) => {
    try {
      setVtoContext(prev => ({
        ...prev,
        topId: queueItem.topId,
        bottomId: queueItem.bottomId,
        neutralPoseId: queueItem.neutralPoseId,
      }));

      let assetCheck = await startAssetCheck({
        topId: queueItem.topId,
        bottomId: queueItem.bottomId,
        neutralPoseId: queueItem.neutralPoseId,
      });

      if (!assetCheck.ready && assetCheck.reason === 'summaries_outdated') {
        updateJob(queueItem.jobId, {
          message: 'Polishing the details...'
        });
        const gender = queueItem.gender === 'male' || queueItem.gender === 'female' ? queueItem.gender : undefined;
        const productsPayload: { id: string; type: 'top' | 'bottom'; gender?: 'male' | 'female' | 'unisex' }[] = [
          { id: queueItem.topId, type: 'top', gender },
        ];
        if (queueItem.bottomId) {
          productsPayload.push({ id: queueItem.bottomId, type: 'bottom', gender });
        }
        const preSummaries = await vtoApi.summariesPrecheck({
          products: productsPayload,
        });

        if (preSummaries.status === 'missing_assets') {
      const detail = preSummaries.details.map(d => `${d.productId}: ${d.missing.join(', ')}`).join(' | ');
          updateJob(queueItem.jobId, {
            status: 'error',
            message: 'Missing assets for generation',
            error: detail,
          });
          toast({ title: 'Missing assets', description: detail, variant: 'destructive' });
          return;
        }

        const assets = preSummaries.assets || {} as Record<string, { model: string | null; flatlay: string | null }>;
        await computeSummaries({
          top: { productId: queueItem.topId, modelUrl: assets.top?.model || undefined, flatlayUrl: assets.top?.flatlay || undefined },
          bottom: queueItem.bottomId
            ? { productId: queueItem.bottomId, modelUrl: assets.bottom?.model || undefined, flatlayUrl: assets.bottom?.flatlay || undefined }
            : undefined,
        });

        assetCheck = await startAssetCheck({
          topId: queueItem.topId,
          bottomId: queueItem.bottomId,
          neutralPoseId: queueItem.neutralPoseId,
        });
      }

      if (!assetCheck.ready) {
        const reason = assetCheck.reason === 'missing_assets' ? 'Required assets are missing.' : 'Unable to continue generation.';
        updateJob(queueItem.jobId, {
          status: 'error',
          message: reason,
        });
        toast({ title: 'Virtual try-on unavailable', description: reason, variant: 'destructive' });
        return;
      }

      updateJob(queueItem.jobId, {
        message: 'Bringing it to life...'
      });

      const result = await generate({
        topId: queueItem.topId,
        bottomId: queueItem.bottomId,
        neutralPoseId: queueItem.neutralPoseId,
        outfitSnapshot: queueItem.outfitSnapshot,
      });

      updateJob(queueItem.jobId, {
        status: 'completed',
        message: 'View it in Collections.',
        resultUrl: result?.signedUrl || null,
        etaSeconds: undefined,
      });
    } catch (error) {
      const message = (error as Error).message || 'Unknown error';
      updateJob(queueItem.jobId, {
        status: 'error',
        message: 'Generation failed',
        error: message,
      });
      toast({ title: 'VTO error', description: message, variant: 'destructive' });
    }
  }, [setVtoContext, startAssetCheck, updateJob, computeSummaries, toast, generate]);

  const processGenerationQueue = useCallback(() => {
    if (processingGenerationRef.current) return;
    const next = generationQueueRef.current[0];
    if (!next) return;
    processingGenerationRef.current = true;
    setProcessingGenerationJobId(next.jobId);
    updateJob(next.jobId, {
      status: 'in-progress',
      startedAt: Date.now(),
      etaSeconds: GENERATION_ETA_SECONDS,
      message: 'Gathering your look...'
    });

    runGenerationJob(next).finally(() => {
      generationQueueRef.current.shift();
      processingGenerationRef.current = false;
      setProcessingGenerationJobId(null);
      setTimeout(() => processGenerationQueue(), 0);
    });
  }, [runGenerationJob, updateJob]);

  const enqueueGenerationJob = useCallback((payload: Omit<GenerationQueueItem, 'jobId'>) => {
    const jobId = uuidv4();
    const queueItem: GenerationQueueItem = { jobId, ...payload };
    console.debug('[Studio][enqueueGenerationJob] enqueue', {
      jobId,
      topId: payload.topId,
      bottomId: payload.bottomId,
      neutralPoseId: payload.neutralPoseId,
      snapshotBottomId: payload.outfitSnapshot?.bottom_id ?? null,
      snapshotTopId: payload.outfitSnapshot?.top_id ?? null,
      outfitItems: (payload.outfitSnapshot?.items || currentOutfit.items || []).map(item => ({
        id: item.id,
        type: item.type,
      })),
    });
    const willStartImmediately = !processingGenerationRef.current && generationQueueRef.current.length === 0;

    generationQueueRef.current.push(queueItem);

    addJob({
      id: jobId,
      kind: 'generation',
      title: payload.outfitLabel ? `Try-on: ${payload.outfitLabel}` : 'Virtual Try-On',
      status: willStartImmediately ? 'in-progress' : 'queued',
      createdAt: Date.now(),
      startedAt: willStartImmediately ? Date.now() : null,
      etaSeconds: GENERATION_ETA_SECONDS,
      message: willStartImmediately ? 'Gathering your look...' : 'Waiting for your turn',
      stages: GENERATION_STAGES.map(stage => ({ ...stage })),
    });

    if (willStartImmediately) {
      processGenerationQueue();
    } else {
      setTimeout(() => processGenerationQueue(), 0);
    }

    return jobId;
  }, [addJob, processGenerationQueue]);

  const handlePoseSelected = useCallback((poseId: string) => {
    const top = currentOutfit.items.find(i => i.type === 'top');
    if (!top) {
      toast({
        title: 'Add a Topwear item',
        description: 'Select at least a top to generate a try-on.',
      });
      return;
    }
    const bottom = currentOutfit.items.find(i => i.type === 'bottom') || null;
    console.debug('[Studio][handlePoseSelected] outfit snapshot at enqueue time', {
      poseId,
      hasBottom: !!bottom,
      bottomId: bottom?.id || null,
      currentItems: currentOutfit.items.map(item => ({ id: item.id, type: item.type })),
    });

    const shoes = currentOutfit.items.find(i => i.type === 'shoes') || null;
    const gender = (currentOutfit.gender === 'male' || currentOutfit.gender === 'female' || currentOutfit.gender === 'unisex') ? currentOutfit.gender : null;

    const snapshot = {
      id: currentOutfit.id,
      name: currentOutfit.name || 'VTO Generation',
      category: currentOutfit.category,
      background_id: currentOutfit.backgroundId || null,
      occasion: currentOutfit.occasion?.id || null,
      gender,
      top_id: top.id,
      bottom_id: bottom?.id || null,
      shoes_id: shoes?.id || null,
    };

    enqueueGenerationJob({
      topId: top.id,
      bottomId: bottom?.id || null,
      neutralPoseId: poseId,
      outfitSnapshot: snapshot,
      outfitLabel: currentOutfit.name || 'Current outfit',
      gender,
    });

    setShowVtoSheet(false);
    setVtoSheetMode(null);
  }, [currentOutfit, enqueueGenerationJob, toast]);

  const handleVtoSheetOpenChange = useCallback((open: boolean) => {
    setShowVtoSheet(open);
    if (!open && vtoSheetMode === 'likeness') {
      setVtoSheetMode(null);
    }
  }, [vtoSheetMode]);

  const handleCandidatesGenerating = useCallback(() => {
    const jobId = uuidv4();
    candidateJobIdRef.current = jobId;
    setActiveCandidateJobId(null);
    setVtoSheetMode(null);
    setShowVtoSheet(false);
    addJob({
      id: jobId,
      kind: 'likeness',
      title: 'Creating your likeness',
      status: 'in-progress',
      createdAt: Date.now(),
      startedAt: Date.now(),
      etaSeconds: LIKENESS_ETA_SECONDS,
      message: 'Processing your photos to neutralize pose.',
      stages: LIKENESS_STAGES.map(stage => ({ ...stage })),
    });
  }, [addJob]);

  const handleCandidatesGenerated = useCallback((payload: CandidatePayload) => {
    const jobId = candidateJobIdRef.current;
    if (!jobId) return;
    setCandidateJobData(prev => ({ ...prev, [jobId]: payload }));
    setActiveCandidateJobId(jobId);
    setVtoSheetMode('candidates');
    setShowVtoSheet(true);
    updateJob(jobId, {
      status: 'awaiting-user',
      message: 'Candidates ready. Pick your likeness to continue.',
      etaSeconds: undefined,
      error: null,
    });
  }, [updateJob]);

  const handleCandidateUse = useCallback(async (candidateIndex: number) => {
    const jobId = activeCandidateJobId || candidateJobIdRef.current;
    if (!jobId) return;
    const payload = candidateJobData[jobId];
    if (!payload) return;

    updateJob(jobId, {
      status: 'in-progress',
      message: 'Saving your neutral pose...',
      error: null,
    });

    try {
      const response = await vtoApi.neutralSelect({ uploadBatchId: payload.uploadBatchId, candidateIndex, setActive: true });
      updateJob(jobId, {
        status: 'completed',
        message: 'Likeness saved. Ready for try-ons.',
        etaSeconds: undefined,
      });
      setShowVtoSheet(false);
      setVtoSheetMode(null);
      setCandidateJobData(prev => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
      setActiveCandidateJobId(null);
      candidateJobIdRef.current = null;
      handlePoseSelected(response.neutralPoseId);
    } catch (error) {
      const message = (error as Error).message || 'Unable to save this candidate.';
      updateJob(jobId, {
        status: 'awaiting-user',
        message: 'Please choose a candidate to continue.',
        error: message,
      });
      toast({ title: 'Could not save neutral pose', description: message, variant: 'destructive' });
    }
  }, [activeCandidateJobId, candidateJobData, handlePoseSelected, toast, updateJob]);

  const handleReviewJob = useCallback((jobId: string) => {
    const payload = candidateJobData[jobId];
    if (!payload) return;
    setActiveCandidateJobId(jobId);
    setVtoSheetMode('candidates');
    setShowVtoSheet(true);
  }, [candidateJobData]);

  const handleViewResult = useCallback((jobId: string) => {
    if (typeof window !== 'undefined') {
      const evt = new CustomEvent('navigateToCollections');
      window.dispatchEvent(evt);
    }
    updateJob(jobId, {
      message: 'Opened in Collections',
    });
  }, [updateJob]);

  const handleCancelJob = useCallback((jobId: string) => {
    const queueIndex = generationQueueRef.current.findIndex(item => item.jobId === jobId);
    if (queueIndex !== -1) {
      generationQueueRef.current.splice(queueIndex, 1);
      removeJob(jobId);
    }
  }, [removeJob]);

  const activeCandidateData = activeCandidateJobId ? candidateJobData[activeCandidateJobId] : null;

  // Similar items dataset when filterMode === 'similar'
  const [similarAlternatives, setSimilarAlternatives] = useState<OutfitItem[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  // Wardrobe (staples) dataset for Alternatives panel
  const [wardrobeAlternatives, setWardrobeAlternatives] = useState<OutfitItem[]>([]);
  const [wardrobeLoading, setWardrobeLoading] = useState(false);
  const [allAlternativesCache, setAllAlternativesCache] = useState<Record<string, OutfitItem[]>>({});
  // New: track which item type the user is browsing inside the panel
  const [panelItemType, setPanelItemType] = useState<'top' | 'bottom' | 'shoes' | 'occasion' | null>(null);
  // Track slot midpoints to position pills at left side
  const [slotMidpoints, setSlotMidpoints] = useState<{ top: number; bottom: number; shoes: number; containerWidth: number } | null>(null);

  // Image overlay state
  const [imageOverlayOpen, setImageOverlayOpen] = useState(false);
  const [imageOverlayItem, setImageOverlayItem] = useState<OutfitItem | null>(null);
  const overlayProductId = imageOverlayItem?.id || '';
  const overlayPrimaryUrl = imageOverlayItem?.imageUrl || '';
  const { allImages: overlayImages } = useProductImages(overlayProductId, overlayPrimaryUrl);

  // One-time swipe nudge (chevrons) state
  const [showSwipeNudge, setShowSwipeNudge] = useState(false);
  // Layers popover
  const [showLayers, setShowLayers] = useState(false);
  const [layeringOrder, setLayeringOrder] = useState<Array<'top' | 'bottom' | 'shoes'>>(['top','bottom','shoes']);
  const [dragKey, setDragKey] = useState<'top' | 'bottom' | 'shoes' | null>(null);

  // Keep layering order in sync with present items (preserve relative order for present ones)
  useEffect(() => {
    const present = (['top','bottom','shoes'] as const).filter(t => currentOutfit.items.some(i => i.type === t));
    setLayeringOrder(prev => {
      const kept = prev.filter(t => present.includes(t as any)) as Array<'top'|'bottom'|'shoes'>;
      const missing = present.filter(t => !kept.includes(t));
      return [...kept, ...missing];
    });
  }, [currentOutfit.items]);

  // Decide whether to show the nudge (mobile only, first time per session)
  useEffect(() => {
    const enabled = STUDIO_CONFIG.SHOW_SWIPE_NUDGE;
    const isCoarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const seen = typeof window !== 'undefined' && sessionStorage.getItem('studio:swipe-nudge-seen') === '1';
    if (enabled && isCoarse && !seen) {
      setShowSwipeNudge(true);
      const t = setTimeout(() => {
        setShowSwipeNudge(false);
        try { sessionStorage.setItem('studio:swipe-nudge-seen', '1'); } catch {}
      }, 2400);
      return () => clearTimeout(t);
    }
  }, []);

  const markNudgeSeen = () => {
    setShowSwipeNudge(false);
    try { sessionStorage.setItem('studio:swipe-nudge-seen', '1'); } catch {}
  };

  // When overlay state changes, coordinate global nav visibility like VTO sheet
  useEffect(() => {
    if (imageOverlayOpen) {
      window.dispatchEvent(new Event('ui:overlay-open'))
    } else {
      window.dispatchEvent(new Event('ui:overlay-close'))
    }
  }, [imageOverlayOpen])

  // Initialize undo/redo functionality
  const {
    saveToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    getHistoryInfo
  } = useUndoRedo({
    currentOutfit,
    session,
    onOutfitChange: (newOutfit) => {
      setCurrentOutfit(newOutfit);
      // Save session with updated outfit
      saveSession(outfit, newOutfit, originalOutfit, newOutfit.backgroundId);
      // Notify parent of outfit change
      onOutfitChange?.(newOutfit);
    },
    saveSession
  });

  // Setup react-hook-form
  const methods = useForm<FinalizeFormValues>({
    defaultValues: {
      name: currentOutfit.name || '',
      category: currentOutfit.category || '',
      fit: currentOutfit.fit || '',
      feel: currentOutfit.feel || '',
      description: '',
      word_association: [],
    },
    mode: 'onChange',
  });

  // Get validation rules based on finalize mode
  const getValidationRules = (fieldName: string) => {
    if (finalizeMode === 'private') {
      return {}; // No validation for private saves
    }
    
    // Validation for public saves
    switch (fieldName) {
      case 'name':
        return { required: 'Name is required for public outfits' };
      case 'category':
        return { required: 'Category is required for public outfits' };
      default:
        return {};
    }
  };
  const { control, handleSubmit, setValue, getValues, formState: { errors } } = methods;

  // Responsive container height for Studio
  const ContainerHeightStudio = Math.min(window.innerHeight * 0.7, 600);
  // Background opacity for Studio
  const BACKGROUND_OPACITY_STUDIO = 70; // Tailwind: 70 = 70%

  // Helper: check if outfit has changed
  const isOutfitChanged = JSON.stringify(currentOutfit.items) !== JSON.stringify(originalOutfit.items) ||
    currentOutfit.backgroundId !== originalOutfit.backgroundId;
  


  // Handler: open dialog (unused helper retained only for clarity)
  // Handler: close dialog
  const handleCloseFinalize = () => {
    setShowFinalizeDialog(false);
    setFinalizeMode(null);
  };

  // Handler: add word association tag
  const handleAddTag = (tag) => {
    const tags = getValues('word_association');
    if (tag && !tags.includes(tag) && tags.length < 5) {
      setValue('word_association', [...tags, tag]);
    }
  };
  // Handler: remove word association tag
  const handleRemoveTag = (tag) => {
    const tags = getValues('word_association');
    setValue('word_association', tags.filter(t => t !== tag));
  };

  // Log studio_open interaction when component mounts - ONLY ONCE per session
  useEffect(() => {
    // Only log studio_open when the component first mounts with this outfit
    // Not when the outfit changes due to remix
    logInteraction(
      'studio_open',
      outfit.id, // Use original outfit, not currentOutfit
      outfit.category,
      INTERACTION_WEIGHTS.studio_open,
      {
        outfit_name: outfit.name,
        outfit_price: outfit.totalPrice,
        outfit_items_count: outfit.items.length,
        outfit_items: outfit.items.map(item => ({
          type: item.type,
          brand: item.brand,
          price: item.price
        })),
        session_id: Date.now() // Track session
      }
    );
  }, []); // Empty dependency array - only runs once when component mounts

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if user is not typing in an input field
      const activeElement = document.activeElement;
      const isTyping = activeElement?.tagName === 'INPUT' || 
                      activeElement?.tagName === 'TEXTAREA' || 
                      (activeElement as HTMLElement)?.contentEditable === 'true';
      
      if (isTyping) return;

      // Undo: Ctrl+Z (or Cmd+Z on Mac)
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (canUndo()) {
          undo();
        }
      }
      
      // Redo: Ctrl+Y or Ctrl+Shift+Z (or Cmd+Y/Cmd+Shift+Z on Mac)
      if ((event.ctrlKey || event.metaKey) && 
          (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault();
        if (canRedo()) {
          redo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);

  // Hide bottom navigation while VTO sheet is open using global overlay events
  useEffect(() => {
    if (showVtoSheet) {
      window.dispatchEvent(new Event('ui:overlay-open'))
    } else {
      window.dispatchEvent(new Event('ui:overlay-close'))
    }
  }, [showVtoSheet])

  // Safety: ensure nav is restored if component unmounts while sheet might be open
  useEffect(() => {
    return () => {
      window.dispatchEvent(new Event('ui:overlay-close'))
    }
  }, [])

  const handleItemSelect = (item: OutfitItem) => {
    setSelectedItem(item);
    setPanelItemType(item.type as 'top' | 'bottom' | 'shoes');
    setShowAlternatives(true);
    markNudgeSeen();
  };

  // Open overlay for an item (used by swipe gesture)
  const openImageOverlayForItem = (item: OutfitItem) => {
    if (!item) return;
    setImageOverlayItem(item);
    setImageOverlayOpen(true);
    markNudgeSeen();
  };

  const closeImageOverlay = () => {
    setImageOverlayOpen(false);
    // keep item for smoother reopen
  };

  const handlePanelItemTypeChange = (newType: 'top' | 'bottom' | 'shoes' | 'occasion') => {
    setPanelItemType(newType);
    if (newType === 'occasion') {
      // Switch to background mode by creating a synthetic occasion item
      const backgroundItem = {
        id: 'background',
        type: 'occasion' as const,
        description: currentOutfit.occasion?.name || 'Background',
        brand: currentOutfit.occasion?.description || 'Theme',
        price: 0,
        size: '',
        color: '',
        imageUrl: currentOutfit.backgroundId || currentOutfit.occasion.backgroundUrl
      } as OutfitItem;
      setSelectedItem(backgroundItem);
      setShowAlternatives(true);
      return;
    }
    // Find the item of the new type in the current outfit and set it as selectedItem
    const newSelectedItem = currentOutfit.items.find(item => item.type === newType);
    if (newSelectedItem) {
      setSelectedItem(newSelectedItem);
      setShowAlternatives(true);
    } else {
      // No item of this type exists yet: create a lightweight placeholder and open panel in "all" mode
      const placeholder = {
        id: `placeholder-${newType}`,
        type: newType,
        brand: '',
        description: newType === 'top' ? 'Topwear' : newType === 'bottom' ? 'Bottomwear' : 'Footwear',
        price: 0,
        size: '',
        color: '',
        imageUrl: '',
        currency: 'INR'
      } as OutfitItem;
      setSelectedItem(placeholder);
      setFilterMode('all');
      setShowAlternatives(true);
    }
  };

  const handleAlternativeSelect = (newItem: OutfitItem) => {
    // Use panelItemType if available, otherwise fall back to selectedItem.type
    const targetType = panelItemType || selectedItem?.type;
    
    if (targetType) {
      // Save current state to history BEFORE making change
      saveToHistory(
        currentOutfit,
        'item_change',
        targetType,
        `Changed ${targetType} to ${newItem.brand} ${newItem.description}`
      );

      let didReplace = false;
      const updatedItems = currentOutfit.items.map(item => {
        if (item.type === targetType) {
          didReplace = true;
          return newItem;
        }
        return item;
      });
      if (!didReplace) {
        updatedItems.push(newItem);
      }
      
      const newTotalPrice = updatedItems.reduce((sum, item) => sum + item.price, 0);
      
      const newOutfit = {
        ...currentOutfit,
        items: updatedItems,
        totalPrice: newTotalPrice
      };
      
      setCurrentOutfit(newOutfit);
      
      // Save session with updated outfit
      saveSession(outfit, newOutfit, originalOutfit, newOutfit.backgroundId);
      
      // Notify parent of outfit change
      onOutfitChange?.(newOutfit);
      
      // Update selectedItem to reflect the new item for the current type
      setSelectedItem(newItem);

      // Log element_change interaction
      logInteraction(
        'element_change',
        currentOutfit.id,
        currentOutfit.category,
        INTERACTION_WEIGHTS.element_change,
        {
          changed_item_type: targetType,
          new_item_id: newItem.id,
          original_item_id: selectedItem?.id
        }
      );
    }
  };

  // Helper: open panel for a given type. If type missing, open in "all" mode with placeholder
  const openTypePanel = (type: 'top' | 'bottom' | 'shoes') => {
    const existing = currentOutfit.items.find(i => i.type === type);
    setPanelItemType(type);
    if (existing) {
      setSelectedItem(existing);
      setShowAlternatives(true);
    } else {
      const placeholder = {
        id: `placeholder-${type}`,
        type,
        brand: '',
        description: type === 'top' ? 'Topwear' : type === 'bottom' ? 'Bottomwear' : 'Footwear',
        price: 0,
        size: '',
        color: '',
        imageUrl: '',
        currency: 'INR'
      } as OutfitItem;
      setSelectedItem(placeholder);
      setFilterMode('all');
      setShowAlternatives(true);
    }
  };

  // Helper: remove a type from current outfit; switch panel focus to another available type if needed
  const removeType = (type: 'top' | 'bottom' | 'shoes') => {
    const toRemove = currentOutfit.items.find(i => i.type === type);
    if (!toRemove) return;
    // Save history
    saveToHistory(
      currentOutfit,
      'item_change',
      type,
      `Removed ${type}`
    );
    const updatedItems = currentOutfit.items.filter(i => i.type !== type);
    const newTotalPrice = updatedItems.reduce((sum, item) => sum + item.price, 0);
    const newOutfit = {
      ...currentOutfit,
      items: updatedItems,
      totalPrice: newTotalPrice
    };
    setCurrentOutfit(newOutfit);
    saveSession(outfit, newOutfit, originalOutfit, newOutfit.backgroundId);
    onOutfitChange?.(newOutfit);

    // If panel was focused on removed type, switch to another available type
    if (showAlternatives && (panelItemType === type || selectedItem?.type === type)) {
      const preference: Array<'top' | 'bottom' | 'shoes'> = ['top', 'bottom', 'shoes'];
      const nextType = preference.find(t => updatedItems.some(i => i.type === t));
      if (nextType) {
        const nextItem = updatedItems.find(i => i.type === nextType)!;
        setPanelItemType(nextType);
        setSelectedItem(nextItem);
        setShowAlternatives(true);
      } else {
        // No items left; close panel
        setShowAlternatives(false);
        setSelectedItem(null);
        setPanelItemType(null);
      }
    }
  };

  const handleOccasionSelect = (occasion: Occasion) => {
    // Save current state to history BEFORE changing background
    saveToHistory(
      currentOutfit,
      'background_change',
      undefined,
      `Changed background to ${occasion.name}`
    );

    const newOutfit = {
      ...currentOutfit,
      backgroundId: occasion.backgroundUrl
    };
    
    setCurrentOutfit(newOutfit);
    
    // Save session with updated background
    saveSession(outfit, newOutfit, originalOutfit, newOutfit.backgroundId);
    
    // Notify parent of outfit change
    onOutfitChange?.(newOutfit);
    
    // Update the selectedItem to reflect the new background
    if (selectedItem && selectedItem.type === 'occasion') {
      setSelectedItem({
        ...selectedItem,
        imageUrl: occasion.backgroundUrl,
        description: occasion.name,
        brand: occasion.description
      });
    }
  };

  // New remix functionality
  const handleRemix = () => {
    // Get outfits from the SAME category (as requested)
    const sameCategoryOutfits = allOutfits.filter(
      outfit => outfit.category === currentOutfit.category && outfit.id !== currentOutfit.id
    );
    
    if (sameCategoryOutfits.length > 0) {
      // Randomly select a new outfit from same category
      const randomIndex = Math.floor(Math.random() * sameCategoryOutfits.length);
      const newOutfit = sameCategoryOutfits[randomIndex];
      
      // Save current state to history BEFORE remixing
      saveToHistory(
        currentOutfit,
        'remix_change',
        undefined,
        `Remixed to ${newOutfit.name}`
      );
      
      setCurrentOutfit(newOutfit);
      
      // Save session with new remixed outfit
      saveSession(newOutfit, newOutfit, newOutfit, newOutfit.backgroundId); // For remix, the new outfit becomes the original
      
      // Notify parent of outfit change
      onOutfitChange?.(newOutfit);

      // Log remix_click interaction
      logInteraction(
        'remix_click',
        newOutfit.id,
        newOutfit.category,
        INTERACTION_WEIGHTS.remix_click,
        {
          original_outfit_id: currentOutfit.id,
          new_outfit_id: newOutfit.id,
          category: newOutfit.category
        }
      );
    } else {
      alert('No other outfits in same category available for remix');
    }
  };

  // Save functionality - Fixed to work like HomePage
  const handleSave = () => {
    const isCurrentlyFavorite = isFavorite(currentOutfit.id);
    toggleFavorite(currentOutfit);
    
    // Log different interactions based on action
    if (isCurrentlyFavorite) {
      // User is removing from favorites
      logInteraction(
        'favorite_remove',
        currentOutfit.id,
        currentOutfit.category,
        INTERACTION_WEIGHTS.favorite_remove,
        {
          outfit_name: currentOutfit.name,
          outfit_price: currentOutfit.totalPrice,
          outfit_items_count: currentOutfit.items.length,
          outfit_items: currentOutfit.items.map(item => ({
            type: item.type,
            brand: item.brand,
            price: item.price
          })),
          session_id: Date.now()
        }
      );
    } else {
      // User is adding to favorites
      logInteraction(
        'favorite_add',
        currentOutfit.id,
        currentOutfit.category,
        INTERACTION_WEIGHTS.favorite_add,
        {
          outfit_name: currentOutfit.name,
          outfit_price: currentOutfit.totalPrice,
          outfit_items_count: currentOutfit.items.length,
          outfit_items: currentOutfit.items.map(item => ({
            type: item.type,
            brand: item.brand,
            price: item.price
          })),
          session_id: Date.now()
        }
      );
    }
  };

  // Share functionality
  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Check out this ${currentOutfit.category} outfit!`,
          text: `I found this amazing ${currentOutfit.name} outfit on Fashion Style App`,
          url: window.location.href
        });
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(
          `Check out this ${currentOutfit.name} outfit: ${window.location.href}`
        );
      }

      // Log share interaction
      logInteraction(
        'share',
        currentOutfit.id,
        currentOutfit.category,
        INTERACTION_WEIGHTS.share,
        {
          share_method: navigator.share ? 'native_share' : 'clipboard'
        }
      );
    } catch (error) {
      console.error('Failed to share:', error);
    }
  };

  const handleCloseAlternatives = () => {
    setShowAlternatives(false);
    setSelectedItem(null);
  };

  const handleBackgroundSelect = () => {
    // Create a background item using the current occasion data
    const backgroundItem = {
      id: 'background',
      type: 'occasion' as const,
      description: currentOutfit.occasion?.name || 'Background',
      brand: currentOutfit.occasion?.description || 'Theme',
      price: 0,
      size: '',
      color: '',
      imageUrl: currentOutfit.backgroundId || currentOutfit.occasion.backgroundUrl
    } as OutfitItem;
    
    setSelectedItem(backgroundItem);
    setPanelItemType('occasion');
    setShowAlternatives(true);
  };

  // Prefetch images for currently worn items (top/bottom/shoes)
  useEffect(() => {
    const prefetch = async () => {
      try {
        const items = currentOutfit.items.filter(i => i.type === 'top' || i.type === 'bottom' || i.type === 'shoes');
        await Promise.all(
          items.map(i => preloadProductImages(i.id, i.imageUrl, 2))
        );
      } catch (e) {
        // Non-fatal; skip
        console.warn('[Prefetch] image prefetch failed', (e as Error).message);
      }
    };
    prefetch();
  }, [currentOutfit.items]);

  // Handler: Save to favorites (private)
  const handleSaveToFavorites = () => {
    setFinalizeMode('private');
    setShowFinalizeDialog(true);
  };

  // Handler: Save & Publish (public)
  const handleSaveAndPublish = () => {
    setFinalizeMode('public');
    setShowFinalizeDialog(true);
  };

  const onSubmit = async (data: FinalizeFormValues) => {
    // Check if user is in guest mode
    if (guestState.isGuest) {
      toast({
        title: 'Create an account to save / publish your outfits',
        description: 'Create an account to save / publish your outfits and access all features like favorites, publishing, and sharing.',
        variant: 'default',
      });
      setShowFinalizeDialog(false);
      setFinalizeMode(null);
      methods.reset();
      return;
    }

    // Prepare payload
    const top = currentOutfit.items.find(i => i.type === 'top');
    const bottom = currentOutfit.items.find(i => i.type === 'bottom');
    const shoes = currentOutfit.items.find(i => i.type === 'shoes');
    const selectedCategory = categories.find(cat => cat.id === data.category);
    const payload = {
      id: uuidv4(),
      name: data.name || currentOutfit.name,
      category: selectedCategory?.id || currentOutfit.category,
      background_id: currentOutfit.backgroundId || null,
      occasion: currentOutfit.occasion?.id || null,
      top_id: top?.id || null,
      bottom_id: bottom?.id || null,
      shoes_id: shoes?.id || null,
      created_by: profile?.name || null,
      fit: data.fit || null,
      feel: data.feel || null,
      description: data.description || null,
      word_association: data.word_association && data.word_association.length > 0 ? data.word_association.join(',') : null,
      visible_in_feed: finalizeMode === 'public', // Set based on mode
      // popularity, rating, gender, outfit_match omitted (use defaults)
    };
    // Remove undefined/null fields for optional columns
    Object.keys(payload).forEach(key => {
      if (payload[key] === null || payload[key] === undefined) {
        delete payload[key];
      }
    });
    // Insert into DB
    const { data: newOutfit, error } = await addOutfit(payload);
    if (error) {
      console.error('Supabase insert error:', error);
      toast({ title: 'Error', description: 'Failed to save outfit. Please try again.', variant: 'destructive' });
      return;
    }
    // Add to favorites
    if (newOutfit) {
      await addFavorite(newOutfit);
      
      // Show appropriate success message based on mode
      if (finalizeMode === 'private') {
        toast({
          title: 'Outfit saved to favorites!',
          description: 'Your outfit has been saved privately to your favorites.',
        });
      } else {
        toast({
          title: 'Outfit published and added to favorites!',
          description: (
            <span>
              <span>Your outfit is now public and has been added to favorites. </span>
              <button
                className="underline text-primary ml-1"
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: `Check out my outfit on ATLYR!`,
                      text: `I just created this look on ATLYR. See it here:`,
                      url: window.location.href,
                    });
                  } else {
                    navigator.clipboard.writeText(window.location.href);
                  }
                }}
              >
                Share
              </button>
            </span>
          ),
        });
      }
      
      setShowFinalizeDialog(false);
      setFinalizeMode(null);
      methods.reset();
      refetchOutfits();
    }
  };

  const userGender = (profile?.gender === 'male' || profile?.gender === 'female') ? profile.gender : undefined;
  const outfitGender = (currentOutfit.gender === 'male' || currentOutfit.gender === 'female') ? currentOutfit.gender : null;
  const genderForAlternatives = outfitGender || userGender;
  const effectiveType = panelItemType || selectedItem?.type;
  const allCacheKey = effectiveType ? `${effectiveType}-${genderForAlternatives ?? 'all'}` : null;
  const cachedAllAlternatives = allCacheKey ? allAlternativesCache[allCacheKey] : undefined;
  const alternatives = selectedItem && effectiveType
    ? (
        filterMode === 'similar'
          ? similarAlternatives
          : filterMode === 'wardrobe'
            ? wardrobeAlternatives
            : filterMode === 'all'
              ? (cachedAllAlternatives !== undefined
                  ? cachedAllAlternatives
                  : getAlternativeItems(effectiveType as any, currentOutfit, filterMode, genderForAlternatives))
              : (() => {
                  // Base alternatives by type and gender
                  const base = getAlternativeItems(effectiveType as any, currentOutfit, filterMode, genderForAlternatives);
                  // For alternate mode, exclude items that appear in the Similar set for the selected product
                  if (filterMode === 'alternate' && similarAlternatives.length > 0) {
                    const similarIds = new Set(similarAlternatives.map(i => i.id));
                    return base.filter(i => !similarIds.has(i.id));
                  }
                  return base;
                })()
      )
    : [];

  // Fetch similar items from DB via RPC when in "similar" mode
  useEffect(() => {
    const fetchSimilar = async () => {
      if (!selectedItem || filterMode !== 'similar') return;
      try {
        setSimilarLoading(true);
        const { data, error } = await (supabase as any).rpc('get_similar_products', { product_id_param: selectedItem.id });
        if (error) {
          console.error('Error fetching similar products:', error.message);
          setSimilarAlternatives([]);
          return;
        }
        const rows = Array.isArray(data) ? (data as any[]) : [];
        // Map to OutfitItem and ensure same type as selected item
        type SimilarProductRow = {
          id: string;
          type: 'top' | 'bottom' | 'shoes' | 'accessory';
          brand: string;
          product_name: string | null;
          size: string;
          price: number;
          currency: string;
          image_url: string;
          description: string;
          color: string;
          color_group: string | null;
          gender: 'male' | 'female' | 'unisex' | null;
          placement_y: number | null;
          placement_x: number | null;
          image_length: number | null;
          fit: string | null;
          feel: string | null;
          category_id: string | null;
          vibes?: string | null;
          type_category?: string | null;
        };

        const mapped = rows
          .map((row: any) => dataTransformers.product({
            id: row.id,
            type: row.type,
            brand: row.brand,
            gender: row.gender,
            product_name: row.product_name,
            size: row.size,
            price: row.price,
            currency: row.currency,
            image_url: row.image_url,
            description: row.description,
            color: row.color,
            color_group: row.color_group,
            category_id: row.category_id,
            fit: row.fit,
            feel: row.feel,
            placement_x: row.placement_x,
            placement_y: row.placement_y,
            image_length: row.image_length
          }))
          .filter(item => item.type === selectedItem.type);
        setSimilarAlternatives(mapped);
      } catch (e) {
        console.error('Unexpected error fetching similar products:', (e as Error).message);
        setSimilarAlternatives([]);
      } finally {
        setSimilarLoading(false);
      }
    };

    fetchSimilar();
  }, [filterMode, selectedItem]);

  useEffect(() => {
    if (filterMode !== 'all' || !effectiveType || !allCacheKey) return;
    if (cachedAllAlternatives !== undefined) return;

    let isActive = true;

    const fetchAllAlternatives = async () => {
      try {
        let query = supabase
          .from('products')
          .select('*')
          .eq('type', effectiveType);

        if (genderForAlternatives) {
          query = query.in('gender', [genderForAlternatives, 'unisex']);
        }

        const { data, error } = await query;
        if (error) {
          console.error('Error fetching all products for alternatives:', error.message);
          return;
        }

        const rows = Array.isArray(data) ? data : [];
        const mapped = rows
          .map((row: any) => dataTransformers.product(row))
          .filter(item => item.type === effectiveType);

        if (!isActive) return;
        setAllAlternativesCache(prev => ({ ...prev, [allCacheKey]: mapped }));
      } catch (e) {
        console.error('Unexpected error fetching all products for alternatives:', (e as Error).message);
      }
    };

    fetchAllAlternatives();

    return () => {
      isActive = false;
    };
  }, [filterMode, effectiveType, genderForAlternatives, allCacheKey, cachedAllAlternatives]);

  // Keep panel item type in sync with current selection when opening
  useEffect(() => {
    if (selectedItem && !panelItemType) {
      const t = selectedItem.type;
      setPanelItemType((t === 'top' || t === 'bottom' || t === 'shoes' || t === 'occasion') ? t : null);
    }
  }, [selectedItem, panelItemType]);

  // Fetch staples (wardrobe) items for the active category when in "wardrobe" mode
  useEffect(() => {
    const fetchWardrobe = async () => {
      if (!effectiveType || filterMode !== 'wardrobe') return;
      try {
        setWardrobeLoading(true);

        // Select the appropriate staples CSV from profile based on current panel item type
        const staplesCsv = effectiveType === 'top'
          ? (profile?.top_staples || '')
          : effectiveType === 'bottom'
            ? (profile?.bottom_staples || '')
            : effectiveType === 'shoes'
              ? (profile?.shoes_staples || '')
              : '';

        const ids = staplesCsv
          .split(',')
          .map(id => id.trim())
          .filter(Boolean);

        if (ids.length === 0) {
          setWardrobeAlternatives([]);
          return;
        }

        // Build query: match IDs, ensure same type, prefer matching gender or unisex
        let query = supabase
          .from('products')
          .select('*')
          .in('id', ids)
          .eq('type', effectiveType);

        if (userGender) {
          query = query.in('gender', [userGender, 'unisex']);
        }

        // Optional: reinforce staples type_category when present
        query = query.eq('type_category', 'staples');

        const { data, error } = await query;
        if (error) {
          console.error('Error fetching wardrobe staples:', error.message);
          setWardrobeAlternatives([]);
          return;
        }

        const rows = Array.isArray(data) ? data : [];
        const mapped = rows
          .map((row: any) => dataTransformers.product(row))
          .filter(item => item.type === effectiveType);

        // Preserve the order of IDs from profile if possible
        const orderIndex: Record<string, number> = ids.reduce((acc: Record<string, number>, id, idx) => {
          acc[id] = idx;
          return acc;
        }, {});
        mapped.sort((a, b) => (orderIndex[a.id] ?? 0) - (orderIndex[b.id] ?? 0));

        setWardrobeAlternatives(mapped);
      } catch (e) {
        console.error('Unexpected error fetching wardrobe staples:', (e as Error).message);
        setWardrobeAlternatives([]);
      } finally {
        setWardrobeLoading(false);
      }
    };

    fetchWardrobe();
  }, [filterMode, effectiveType, profile?.top_staples, profile?.bottom_staples, profile?.shoes_staples, userGender]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Product Images Overlay */}
      <Dialog open={imageOverlayOpen} onOpenChange={setImageOverlayOpen}>
        <DialogContent
          className="p-0 max-w-full w-[100vw] h-[100vh] sm:h-[92vh] sm:rounded-xl overflow-hidden border-0"
          hideCloseButton
          fullscreen
        >
          {/* Visually hidden a11y labels to satisfy Radix requirements */}
          <DialogHeader className="sr-only">
            <DialogTitle>{imageOverlayItem ? `${imageOverlayItem.brand} images` : 'Product images'}</DialogTitle>
            <DialogDescription>Swipe horizontally to view different angles. Tap close to return to the studio.</DialogDescription>
          </DialogHeader>
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-14 bg-background/90 backdrop-blur border-b border-border">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{imageOverlayItem?.brand}</div>
              {imageOverlayItem?.price ? (
                <div className="text-xs text-muted-foreground truncate">{formatCurrency(imageOverlayItem.price)}</div>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" onClick={closeImageOverlay} className="rounded-full">
              <X className="w-5 h-5" />
            </Button>
          </div>
          {/* Image Area */}
          <div className="p-3 h-[calc(100%-56px)]">
            <ProductImageCarousel
              images={overlayImages.map((img, idx) => ({ id: img.id || `img-${idx}` , url: img.url, alt: imageOverlayItem?.description || `Image ${idx + 1}` }))}
              className="h-full"
            />
          </div>
        </DialogContent>
      </Dialog>
      {/* Header */}
      <StudioHeader
        onBack={onBack}
        rightContent={
          <VtoJobCenter
            jobs={vtoJobs}
            onReviewJob={handleReviewJob}
            onViewResult={handleViewResult}
            onCancelJob={handleCancelJob}
          />
        }
      />

      {/* Main Content */}
      <div className="flex-1 pb-32 relative">
        {/* Avatar Display */}
        <div className={cn(
          "p-4 border-b border-border transition-all duration-500",
          showAlternatives ? "min-w-[250px] mr-[25vw]" : ""
        )}>
          <Card className="bg-transparent border-none shadow-none studio-background">
            <CardContent className="p-6 bg-transparent relative">
              {/* Enhanced Background */}
              <div className="absolute inset-0 rounded-lg overflow-hidden">
                <img 
                  src={
                    isPreviewOriginal && session?.checkpointOutfit
                      ? (session.checkpointOutfit.backgroundId || session.checkpointOutfit.occasion?.backgroundUrl)
                      : (currentOutfit.backgroundId || currentOutfit.occasion.backgroundUrl)
                  }
                  alt="Outfit Background"
                  className={cn(
                    "w-full h-full object-cover transition-all duration-500",
                    `opacity-${BACKGROUND_OPACITY_STUDIO}`
                  )}
                />
                <div className="absolute inset-0 bg-gradient-to-br from-black/10 via-transparent to-black/5" />
              </div>
              
              {/* Enhanced Background Selection Button */}
              <div className="absolute top-4 right-4 z-30">
                <Button
                  variant="secondary"
                  size="icon"
                  className="floating-action-button w-9 h-9 ripple-effect background-button"
                  onClick={handleBackgroundSelect}
                  title="Change Background"
                  aria-label="Change outfit background"
                >
                  <Brackets className="w-5 h-5 text-foreground transition-transform duration-200 hover:rotate-12" />
                </Button>
              </div>
              
              <div className={cn(
                "relative z-10 flex justify-center mb-4 studio-avatar-container",
                showAlternatives ? "panel-open" : ""
              )}>
                <DynamicAvatar 
                  items={isPreviewOriginal && session?.checkpointOutfit ? (session.checkpointOutfit.items || []) : currentOutfit.items}
                  className="mx-auto dynamic-avatar transition-all duration-300"
                  onItemSelect={handleItemSelect}
                  onItemSwipeRight={openImageOverlayForItem}
                  backgroundUrl={null} // Don't render background in DynamicAvatar since StudioPage handles it
                  containerHeight={ContainerHeightStudio}
                  selectedItemType={showAlternatives ? ((panelItemType === 'occasion' ? null : panelItemType) || (selectedItem?.type === 'occasion' ? null : (selectedItem?.type as 'top' | 'bottom' | 'shoes' | null))) : null}
                  onSlotPositions={(pos) => setSlotMidpoints(pos)}
                  layeringOrder={layeringOrder}
                />

                {/* Swipe Nudge Arrows (mobile only, once per session) */}
                {showSwipeNudge && slotMidpoints && (
                  <div className="pointer-events-none absolute inset-0 z-20">
                    {(['top','bottom','shoes'] as const).map((t) => {
                      const existing = currentOutfit.items.find(i => i.type === t);
                      if (!existing) return null;
                      const y = t === 'top' ? slotMidpoints.top : t === 'bottom' ? slotMidpoints.bottom : slotMidpoints.shoes;
                      const style: React.CSSProperties = {
                        position: 'absolute',
                        top: Math.max(16, y - 10),
                        left: `calc(50% + 60px)`,
                        transform: 'translateX(-50%)',
                        opacity: 0.85,
                      };
                      return (
                        <div key={`nudge-${t}`} style={style}>
                          <div className="flex gap-1 items-center">
                            <ChevronRight className="w-4 h-4 text-foreground/70 nudge-chevron" />
                            <ChevronRight className="w-4 h-4 text-foreground/60 nudge-chevron delay-1" />
                            <ChevronRight className="w-4 h-4 text-foreground/50 nudge-chevron delay-2" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* Pills: side or bottom based on config */}
              {STUDIO_CONFIG.PILL_PLACEMENT === 'side' && slotMidpoints && (
                <>
                  {(['top','bottom','shoes'] as const).map((t) => {
                    const existing = currentOutfit.items.find(i => i.type === t);
                    const label = t === 'top' ? 'Topwear' : t === 'bottom' ? 'Bottomwear' : 'Footwear';
                    const y = t === 'top' ? slotMidpoints.top : t === 'bottom' ? slotMidpoints.bottom : slotMidpoints.shoes;
                    const pillStyle: React.CSSProperties = {
                      position: 'absolute',
                      top: `calc(${y}px - 12px)`,
                      left: showAlternatives ? '-0.5rem' : '0rem',
                      transform: 'translateX(0)',
                      zIndex: 40,
                      pointerEvents: showAlternatives ? 'none' : 'auto',
                      opacity: showAlternatives ? 0 : 1,
                    };
                    return (
                      <div key={`pill-${t}`} style={pillStyle}>
                        {existing ? (
                          <button
                            className="whitespace-nowrap inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background/40 backdrop-blur-sm px-2 py-1 h-6 text-[11px] shadow-sm"
                            onClick={() => openTypePanel(t)}
                            title={label}
                          >
                            <span className="truncate max-w-[7rem]">{existing.brand}{existing.price ? `: ${formatCurrency(existing.price)}` : ''}</span>
                            <span
                              className="ml-1 inline-flex items-center justify-center text-muted-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeType(t);
                              }}
                              aria-label={`Remove ${label}`}
                            >
                              <X className="w-3 h-3" />
                            </span>
                          </button>
                        ) : (
                          <button
                            className="whitespace-nowrap inline-flex items-center gap-1.5 rounded-md border border-dashed border-border/50 bg-background/40 backdrop-blur-sm px-2 py-1 h-6 text-[11px]"
                            onClick={() => openTypePanel(t)}
                            title={`Add: ${label}`}
                          >
                            <Plus className="w-3 h-3" />
                            <span>{`Add: ${label}`}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {showAlternatives && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-20 w-[2px] bg-border/80 opacity-90"
                      style={{ zIndex: 35 }}
                      aria-hidden="true"
                    />
                  )}
                </>
              )}
              {STUDIO_CONFIG.PILL_PLACEMENT === 'bottom' && (
                <div className="relative z-20 flex justify-center items-center gap-2 px-4 mb-2 flex-nowrap">
                  {(['top','bottom','shoes'] as const).map((t) => {
                    const existing = currentOutfit.items.find(i => i.type === t);
                    const label = t === 'top' ? 'Topwear' : t === 'bottom' ? 'Bottomwear' : 'Footwear';
                    return (
                      <div key={`pill-bottom-${t}`} className="flex items-center">
                        {existing ? (
                          <button
                            className="whitespace-nowrap inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/70 backdrop-blur-sm px-2 py-1 h-6 text-[11px] shadow-sm"
                            onClick={() => openTypePanel(t)}
                            title={label}
                          >
                            <span className="truncate max-w-[7rem]">{existing.brand}{existing.price ? `: ${formatCurrency(existing.price)}` : ''}</span>
                            <span
                              className="ml-1 inline-flex items-center justify-center text-muted-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeType(t);
                              }}
                              aria-label={`Remove ${label}`}
                            >
                              <X className="w-3 h-3" />
                            </span>
                          </button>
                        ) : (
                          <button
                            className="whitespace-nowrap inline-flex items-center gap-1.5 rounded-md border border-dashed border-border/70 bg-background/50 backdrop-blur-sm px-2 py-1 h-6 text-[11px]"
                            onClick={() => openTypePanel(t)}
                            title={`Add: ${label}`}
                          >
                            <Plus className="w-3 h-3" />
                            <span>{`Add: ${label}`}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Enhanced Action Buttons - Bottom Right of Canvas (compact) */}
              <div className="absolute bottom-24 right-3 flex flex-col gap-2 z-[60] action-buttons">
                {/* Layers Button with Popover */}
                <Popover open={showLayers} onOpenChange={setShowLayers}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="floating-action-button w-9 h-9 ripple-effect group"
                      title="Layer order"
                    >
                      <Layers className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={8} className="z-[80] w-44 p-2 bg-background/40 backdrop-blur-sm border border-border/50 shadow-sm rounded-lg">
                    <div className="text-[11px] font-medium mb-1 text-muted-foreground">Layer order (top above)</div>
                    <div className="flex flex-col gap-1.5">
                      {layeringOrder
                        .filter(t => currentOutfit.items.some(i => i.type === t))
                        .map((t, idx, arr) => {
                          const label = t === 'top' ? 'Topwear' : t === 'bottom' ? 'Bottomwear' : 'Footwear';
                          const canUp = idx > 0;
                          const canDown = idx < arr.length - 1;
                          return (
                            <div
                              key={`layer-${t}`}
                              className={`flex items-center justify-between rounded-md border border-border/50 bg-background/40 backdrop-blur-sm px-2 h-7 text-[12px] ${dragKey === t ? 'ring-1 ring-border/70' : ''}`}
                              onPointerDown={(e) => {
                                // Start drag only when starting near the left handle area or long-press could be added later
                                const el = e.currentTarget as HTMLDivElement;
                                setDragKey(t);
                                const startY = e.clientY;
                                const startIndex = idx;
                                const handleMove = (ev: PointerEvent) => {
                                  const y = ev.clientY;
                                  // Compute nearest index by comparing to centers of current tiles
                                  const present = layeringOrder.filter(tt => currentOutfit.items.some(i => i.type === tt));
                                  const centers = present.map((key) => {
                                    const node = document.querySelector(`div[data-layer-key="${key}"]`) as HTMLElement | null;
                                    if (!node) return 0;
                                    const r = node.getBoundingClientRect();
                                    return r.top + r.height / 2;
                                  });
                                  // Find closest center
                                  let newIndex = 0;
                                  let minDist = Number.MAX_VALUE;
                                  centers.forEach((c, i) => {
                                    const d = Math.abs(y - c);
                                    if (d < minDist) { minDist = d; newIndex = i; }
                                  });
                                  if (newIndex !== present.indexOf(t)) {
                                    setLayeringOrder(prev => {
                                      const list = prev.filter(tt => currentOutfit.items.some(i => i.type === tt));
                                      const i = list.indexOf(t);
                                      if (i === -1) return list as Array<'top'|'bottom'|'shoes'>;
                                      const copy = [...list];
                                      copy.splice(i, 1);
                                      copy.splice(newIndex, 0, t);
                                      return copy as Array<'top'|'bottom'|'shoes'>;
                                    });
                                  }
                                };
                                const handleUp = () => {
                                  setDragKey(null);
                                  window.removeEventListener('pointermove', handleMove);
                                  window.removeEventListener('pointerup', handleUp);
                                };
                                window.addEventListener('pointermove', handleMove);
                                window.addEventListener('pointerup', handleUp, { once: true });
                              }}
                              data-layer-key={t}
                            >
                              <span className="truncate max-w-[7.5rem] leading-none flex items-center gap-1">
                                <GripVertical className="w-3 h-3 text-muted-foreground" />
                                {label}
                              </span>
                              <span className="flex items-center gap-0.5">
                                <Button variant="ghost" size="icon" className="h-6 w-6 p-0" disabled={!canUp} onClick={() => {
                                  setLayeringOrder(prev => {
                                    const list = prev.filter(tt => currentOutfit.items.some(i => i.type === tt));
                                    const copy = [...list];
                                    const i = copy.indexOf(t);
                                    if (i > 0) { const tmp = copy[i-1]; copy[i-1] = copy[i]; copy[i] = tmp; }
                                    return copy as Array<'top'|'bottom'|'shoes'>;
                                  });
                                }}>
                                  <ChevronUp className="w-3 h-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6 p-0" disabled={!canDown} onClick={() => {
                                  setLayeringOrder(prev => {
                                    const list = prev.filter(tt => currentOutfit.items.some(i => i.type === tt));
                                    const copy = [...list];
                                    const i = copy.indexOf(t);
                                    if (i >= 0 && i < copy.length - 1) { const tmp = copy[i+1]; copy[i+1] = copy[i]; copy[i] = tmp; }
                                    return copy as Array<'top'|'bottom'|'shoes'>;
                                  });
                                }}>
                                  <ChevronDown className="w-3 h-3" />
                                </Button>
                              </span>
                            </div>
                          )
                        })}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setLayeringOrder(['top','bottom','shoes'])}>Reset</Button>
                      <Button variant="secondary" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setShowLayers(false)}>Close</Button>
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Undo Button */}
                <Button
                  variant="secondary"
                  size="icon"
                  className="floating-action-button w-9 h-9 ripple-effect undo-button group"
                  onClick={(e) => {
                    e.stopPropagation();
                    undo();
                  }}
                  disabled={!canUndo()}
                  title={getHistoryInfo().nextUndoDescription || "Undo"}
                >
                  <Undo2 className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
                </Button>

                {/* Redo Button */}
                <Button
                  variant="secondary"
                  size="icon"
                  className="floating-action-button w-9 h-9 ripple-effect redo-button group"
                  onClick={(e) => {
                    e.stopPropagation();
                    redo();
                  }}
                  disabled={!canRedo()}
                  title={getHistoryInfo().nextRedoDescription || "Redo"}
                >
                  <Redo2 className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
                </Button>

                {/* Compare/Checkpoint Button with long-press preview and quick actions */}
                <div className="relative">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="floating-action-button w-9 h-9 ripple-effect compare-button group"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCompareActions((v) => !v);
                    }}
                    onMouseDown={() => setIsPreviewOriginal(true)}
                    onMouseUp={() => setIsPreviewOriginal(false)}
                    onMouseLeave={() => setIsPreviewOriginal(false)}
                    onTouchStart={() => setIsPreviewOriginal(true)}
                    onTouchEnd={() => setIsPreviewOriginal(false)}
                    onTouchCancel={() => setIsPreviewOriginal(false)}
                    title="Compare with Original (hold to preview)"
                  >
                    <GitCompare className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
                  </Button>
                  {showCompareActions && (
                    <div className="absolute bottom-14 right-0 w-44 p-1.5 flex flex-col gap-1.5 rounded-xl shadow-sm bg-background/40 backdrop-blur-sm border border-border/50">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 text-[11px] px-2 rounded-md"
                        onClick={() => {
                          if (!session?.checkpointOutfit) {
                            setShowCompareActions(false);
                            return;
                          }
                          saveToHistory(
                            currentOutfit,
                            'item_change',
                            undefined,
                            'Revert to original'
                          );
                          const cp = session.checkpointOutfit;
                          setCurrentOutfit(cp);
                          saveSession(outfit, cp, originalOutfit, cp.backgroundId);
                          onOutfitChange?.(cp);
                          setShowCompareActions(false);
                        }}
                      >
                        Revert to Original
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[11px] px-2 rounded-md"
                        onClick={() => setShowCompareActions(false)}
                      >
                        Close
                      </Button>
                    </div>
                  )}
                </div>

                {/* Remix Button */}
                <Button
                  variant="secondary"
                  size="icon"
                  className="floating-action-button w-9 h-9 ripple-effect remix-button group"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemix();
                  }}
                  title="Remix Outfit"
                >
                  <RefreshCw className="w-5 h-5 transition-transform duration-300 group-hover:rotate-180" />
                </Button>
                
                {/* Generate (VTO) */}
                <Button
                  variant="default"
                  size="icon"
                  className="floating-action-button w-9 h-9 ripple-effect vto-generate-button group"
                  onClick={(e) => {
                    e.stopPropagation();
                    setVtoStep('neutral-pose');
                    setVtoSheetMode('likeness');
                    setShowVtoSheet(true);
                  }}
                  title="Generate (Virtual Try-On)"
                >
                  <Sparkles className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
                </Button>

                {/* Share Button */}
                <Button
                  variant="secondary"
                  size="icon"
                  className="floating-action-button w-9 h-9 ripple-effect share-button group"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleShare();
                  }}
                  title="Share Outfit"
                >
                  <Share className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
                </Button>

                {/* Save to Favorites (Heart) */}
                <Button
                  variant="secondary"
                  size="icon"
                  className="floating-action-button w-9 h-9 ripple-effect save-favorites-button group"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveToFavorites();
                  }}
                  title="Save to Favorites"
                  onContextMenu={(event) => event.preventDefault()}
                  style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                >
                  <Heart className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
                </Button>

                {/* Publish (Save & Publish) */}
                <Button
                  variant="default"
                  size="icon"
                  className="floating-action-button w-9 h-9 ripple-effect publish-button group"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveAndPublish();
                  }}
                  title="Publish Outfit"
                >
                  <Rocket className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>


      </div>

      {/* Options dialog removed; direct buttons now open the finalize form */}

      {/* Compare dialog removed in favor of quick actions popover */}

      {/* Finalize Outfit Dialog */}
      <Dialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              {finalizeMode === 'private' ? 'Save to Favorites' : 'Save & Publish'}
            </DialogTitle>
            <DialogDescription>
              {finalizeMode === 'private' 
                ? 'Fill in the details below to save your outfit to favorites. All fields are optional.'
                : 'Fill in the details below to publish your outfit. Name and category are required.'
              }
            </DialogDescription>
          </DialogHeader>
          <FormProvider {...methods}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Controller
                name="name"
                control={control}
                rules={{ 
                  maxLength: 32,
                  ...getValidationRules('name')
                }}
                render={({ field }) => (
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">Outfit Name</label>
                    <Input {...field} maxLength={32} placeholder="Enter outfit name" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Max 32 characters.</span>
                      {errors.name && <span className="text-red-500">
                        {errors.name.type === 'required' ? 'Required for public outfits' : 'Too long'}
                      </span>}
                    </div>
                  </div>
                )}
              />
              <Controller
                name="category"
                control={control}
                rules={getValidationRules('category')}
                render={({ field }) => (
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">Category</label>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent className="z-[200]" position="popper" sideOffset={4}>
                        {categoriesLoading ? (
                          <SelectItem value="" disabled>Loading categories...</SelectItem>
                        ) : categories.length > 0 ? (
                          categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="" disabled>No categories available</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {errors.category && (
                      <div className="text-xs text-red-500">
                        {errors.category.message}
                      </div>
                    )}
                  </div>
                )}
              />
              <Controller
                name="fit"
                control={control}
                rules={{ maxLength: 32 }}
                render={({ field }) => (
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">Fit</label>
                    <Input {...field} maxLength={32} placeholder="Fit" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Max 32 characters.</span>
                      {errors.fit && <span className="text-red-500">Too long</span>}
                    </div>
                  </div>
                )}
              />
              <Controller
                name="feel"
                control={control}
                rules={{ maxLength: 32 }}
                render={({ field }) => (
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">Feel</label>
                    <Input {...field} maxLength={32} placeholder="Feel" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Max 32 characters.</span>
                      {errors.feel && <span className="text-red-500">Too long</span>}
                    </div>
                  </div>
                )}
              />
              <Controller
                name="description"
                control={control}
                rules={{ maxLength: 200 }}
                render={({ field }) => (
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">Description</label>
                    <Textarea {...field} maxLength={200} placeholder="Description (optional)" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Max 200 characters.</span>
                      {errors.description && <span className="text-red-500">Too long</span>}
                    </div>
                  </div>
                )}
              />
              <Controller
                name="word_association"
                control={control}
                render={({ field }) => (
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">Word Associations</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {field.value.map((tag, idx) => (
                        <span key={tag} className="bg-muted px-2 py-1 rounded-full text-xs flex items-center gap-1">
                          {tag}
                          <button type="button" className="ml-1 text-red-500" onClick={() => handleRemoveTag(tag)}>&times;</button>
                        </span>
                      ))}
                    </div>
                    <Input
                      type="text"
                      maxLength={16}
                      placeholder="Add tag and press Enter"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const tag = e.currentTarget.value.trim();
                          if (tag) {
                            handleAddTag(tag);
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Up to 5 tags, 16 chars each.</span>
                      {field.value.length >= 5 && <span className="text-red-500">Max tags reached</span>}
                    </div>
                  </div>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={handleCloseFinalize}>Cancel</Button>
                <Button type="submit" variant="default">
                  {finalizeMode === 'private' ? 'Save to Favorites' : 'Save & Publish'}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>

      {/* VTO Flow Bottom Sheet (75% screen) */}
      <Sheet open={showVtoSheet} onOpenChange={handleVtoSheetOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[90vh] p-0 vto-sheet shadow-floating"
          style={{ zIndex: 70, borderRadius: '20px 20px 0 0' }}
        >
          <SheetHeader className="px-6 py-6 border-b border-border/50">
            {vtoSheetMode === 'likeness' && (
              <>
                <SheetTitle className="text-header">Choose Your Likeness</SheetTitle>
              </>
            )}
            {vtoSheetMode === 'candidates' && (
              <>
                <SheetTitle className="text-header">Choose Your Neutral Pose</SheetTitle>
                <SheetDescription className="text-body text-muted-foreground">
                  Swipe through the options and pick the likeness that feels most like you.
                </SheetDescription>
              </>
            )}
            {!vtoSheetMode && (
              <>
                <SheetTitle className="text-header">Virtual Try-On</SheetTitle>
                <SheetDescription className="text-body text-muted-foreground">
                  Follow the prompts to continue your try-on.
                </SheetDescription>
              </>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            {vtoSheetMode === 'likeness' && (
              <NeutralPoseManager
                onPoseSelected={handlePoseSelected}
                onGenerateCandidatesStart={handleCandidatesGenerating}
                onCandidatesGenerated={handleCandidatesGenerated}
              />
            )}

            {vtoSheetMode === 'candidates' && activeCandidateData && (
              <NeutralPoseCandidatesCarousel
                candidateUrls={activeCandidateData.candidateUrls}
                onUseCandidate={handleCandidateUse}
                onBack={() => {
                  setVtoSheetMode('likeness');
                  setShowVtoSheet(true);
                }}
                title="Choose Your Neutral Pose"
                description="Swipe to compare each option. Select the likeness that you want to use for virtual try-on."
                showIntro={false}
              />
            )}

            {vtoSheetMode === 'candidates' && !activeCandidateData && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Gathering your best candidates…
              </div>
            )}
          </div>

          <div className="px-6 py-6 border-t border-border/50 bg-card/80 backdrop-blur-sm flex justify-end">
            <Button
              variant="outline"
              className="shadow-premium"
              onClick={() => setShowVtoSheet(false)}
            >
              Close
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Outfit Details Bottom Sheet */}
      <OutfitDetails
        currentOutfit={currentOutfit}
      />

      {/* Alternatives Panel */}
      {selectedItem && (
        <AlternativesList
          alternatives={alternatives}
          selectedItem={selectedItem}
          currentOutfitItem={currentOutfit.items.find(item => item.type === (panelItemType || selectedItem?.type)) || selectedItem}
          onItemSelect={handleAlternativeSelect}
          onClose={handleCloseAlternatives}
          isVisible={showAlternatives}
          onOccasionSelect={handleOccasionSelect}
          filterMode={filterMode}
          onFilterModeChange={setFilterMode as any}
          outfitGender={currentOutfit.gender === 'male' || currentOutfit.gender === 'female' ? currentOutfit.gender : undefined}
          availableTypes={[...(['top','bottom','shoes','occasion'] as const)] as any}
          presentTypes={(['top','bottom','shoes'] as const).filter(t => currentOutfit.items.some(i => i.type === t)) as any}
          onRemoveType={removeType}
          currentType={(panelItemType || selectedItem.type) as any}
          onTypeChange={handlePanelItemTypeChange}
        />
      )}

      {/* Overlay */}
      {showAlternatives && (
        <div 
          className="fixed inset-0 bg-black/10 z-50"
          onClick={handleCloseAlternatives}
        />
      )}

    </div>
  );
}
