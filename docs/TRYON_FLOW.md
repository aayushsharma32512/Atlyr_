# Virtual Try-On Flow - Complete Technical Documentation

**Last Updated:** January 3, 2026  
**Status:** Current implementation documentation based on codebase analysis

## Overview
The virtual try-on (VTO) feature allows users to see themselves wearing different outfits by generating AI-powered images using their likeness (neutral pose) and selected garments. The flow consists of three major phases: **Likeness Generation**, **Asset Preparation**, and **Try-On Generation**.

---

## Architecture Components

### Frontend Layers
- **UI Components**: `StudioScreen`, `LikenessScreen`, `GenerationsScreen`
- **Hooks**: `useStartLikenessFlow`, `useGenerateTryOn`, `useEnsureSummaries`, `useLikenessCandidates`
- **Services**: `likenessService`, `tryonService`
- **Query Management**: TanStack Query with dedicated query key factories

### Backend Services (Supabase Edge Functions)
- `likeness-upload`: Processes user photos and stores candidates in database (multipart upload)
- `likeness-get-batch`: Retrieves candidate batch from database with signed URLs
- `likeness-select`: Saves selected candidate as permanent neutral pose
- `likeness-set-active`: Marks a pose as the user's active likeness
- `likeness-list`: Fetches all saved neutral poses for a user
- `likeness-delete`: Deletes a saved neutral pose
- `tryon-generate-summary`: Creates garment physics/mesh summaries
- `tryon-generate`: Orchestrates the try-on generation pipeline

### Database Tables
- `likeness_candidates`: Stores all generated candidates with batch tracking (NEW)
- `user_neutral_poses`: Stores user likeness images with metadata
- `user_generations`: Tracks try-on generation jobs and results
- `products`: Contains garment data with `garment_summary_front` field

### Progress Tracking System
- `JobsContext` (`src/features/progress/providers/JobsContext.tsx`): Global state for background jobs
- `FloatingProgressHub` (`src/features/progress/components/FloatingProgressHub.tsx`): Persistent UI showing active and recent jobs
- Real-time polling every 4 seconds from database
- Automatic cleanup of stale jobs (>30 min) and stuck jobs (>10 min)
- localStorage persistence with 30-minute TTL

---

## Database Schema

### Table: `likeness_candidates` (NEW)
Stores all generated candidate images from likeness upload with batch tracking.

```sql
CREATE TABLE likeness_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,                        -- Groups candidates from same upload
  candidate_index INTEGER NOT NULL,              -- 0, 1, 2, etc.
  storage_path TEXT NOT NULL,                    -- Path in 'temp-candidates' bucket
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  identity_summary TEXT,                         -- AI-generated identity description
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient retrieval
CREATE INDEX idx_likeness_candidates_user ON likeness_candidates(user_id);
CREATE INDEX idx_likeness_candidates_batch ON likeness_candidates(batch_id);
CREATE INDEX idx_likeness_candidates_created ON likeness_candidates(created_at DESC);
CREATE INDEX idx_likeness_candidates_user_batch ON likeness_candidates(user_id, batch_id);

-- RLS Policies
ALTER TABLE likeness_candidates ENABLE ROW LEVEL SECURITY;

-- Users can SELECT their own candidates
CREATE POLICY "Users can view own candidates"
  ON likeness_candidates FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can INSERT candidates
CREATE POLICY "Service role can insert candidates"
  ON likeness_candidates FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Users can DELETE their own candidates
CREATE POLICY "Users can delete own candidates"
  ON likeness_candidates FOR DELETE
  USING (auth.uid() = user_id);
```

### Table: `user_neutral_poses`
Stores permanent user likeness images after candidate selection.

```sql
CREATE TABLE user_neutral_poses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,                    -- Path in 'neutral-poses' bucket
  original_fullbody_path TEXT NOT NULL,          -- Original upload in 'temp-candidates'
  original_selfie_path TEXT NOT NULL,            -- Original upload in 'temp-candidates'
  is_active BOOLEAN NOT NULL DEFAULT false,      -- One active pose per user
  status neutral_pose_status NOT NULL DEFAULT 'pending',  -- 'pending' | 'ready' | 'failed'
  metadata JSONB DEFAULT '{}',                   -- Contains identitySummary, uploadBatchId, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index: only one active pose per user
CREATE UNIQUE INDEX idx_user_neutral_poses_active 
  ON user_neutral_poses (user_id) WHERE is_active = true;
```

### Table: `user_generations`
Tracks try-on generation jobs and results.

```sql
CREATE TABLE user_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outfit_id TEXT REFERENCES outfits(id) ON DELETE SET NULL,
  neutral_pose_id UUID NOT NULL REFERENCES user_neutral_poses(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL,                    -- Path in 'generations' bucket
  status generation_status NOT NULL DEFAULT 'queued',  -- 'queued' | 'generating' | 'ready' | 'failed'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Table: `products` Extensions
Products table extended with VTO summary fields.

```sql
ALTER TABLE products 
  ADD COLUMN garment_summary_front JSONB,       -- Physics/mesh analysis for front garment
  ADD COLUMN garment_summary_version TEXT;      -- Version tracking for regeneration
```

---

## Complete Flow Breakdown

### Phase 1: User Initiates Try-On

#### Entry Points
Users can trigger try-on from multiple screens:
1. **StudioScreen** (`src/features/studio/StudioScreen.tsx`)
2. **StudioAlternativesScreen** 
3. **StudioScrollUpScreen**
4. **CreationsTab** (Collections)

#### Trigger Flow
**Location:** `src/features/studio/StudioScreen.tsx`

```typescript
// User clicks "Try On" button in ProductTray
<ProductTray onTryOn={isViewOnly ? undefined : handleTryOn} />

// Handler in StudioScreen (line ~478)
const handleTryOn = useCallback(async () => {
  try {
    // 1. Resolve outfit snapshot (existing or create draft)
    const outfitSnapshot = await resolveTryOnSnapshot()
    
    // 2. Launch likeness flow with outfit context
    await startLikenessFlow({ 
      outfitItems, 
      outfitSnapshot: outfitSnapshot ?? undefined 
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start try-on"
    toast({ title: "Try-on failed", description: message, variant: "destructive" })
  }
}, [outfitItems, resolveTryOnSnapshot, startLikenessFlow, toast])
```

#### Outfit Snapshot Resolution
**Location:** `src/features/studio/StudioScreen.tsx` (line ~435)

This function determines whether to use an existing outfit or create a draft for try-on context.

```typescript
const resolveTryOnSnapshot = useCallback(async () => {
  if (!studioAvatar || !user?.id) {
    return null
  }
  
  const isOwned = studioAvatar.user_id === user.id
  
  // If user owns outfit and hasn't made changes, use existing
  if (isOwned && !hasSlotOverrides) {
    return {
      id: studioAvatar.id,
      name: studioAvatar.name ?? null,
      category: studioAvatar.category ?? null,
      occasionId: studioAvatar.occasion?.id ?? null,
      backgroundId: studioAvatar.backgroundId ?? null,
      gender: studioAvatar.gender ?? null,
    }
  }
  
  // Otherwise, create draft outfit snapshot
  const draft = await createDraftOutfitMutation({
    userId: user.id,
    topId: outfitItems.topId,
    bottomId: outfitItems.bottomId,
    shoesId: outfitItems.footwearId,
    gender: studioAvatar.gender ?? null,
    backgroundId: studioAvatar.backgroundId ?? null,
    createdByName: profile?.name ?? null,
  })
  
  return { 
    id: draft.id, 
    name: draft.name ?? null,
    category: draft.category ?? null,
    occasionId: draft.occasion ?? null,
    backgroundId: draft.background_id ?? null,
    gender: draft.gender ?? null,
  }
}, [
  createDraftOutfitMutation,
  hasSlotOverrides,
  outfitItems,
  profile?.name,
  studioAvatar,
  user?.id,
])
```

**Logic:**
- If user owns the outfit AND hasn't overridden any slots → use existing outfit
- Otherwise → create a temporary draft outfit for try-on context
- Draft outfits are temporary and allow non-owners to try on outfits

---

### Phase 2: Likeness Flow Navigation

#### Hook: `useStartLikenessFlow`
**Location:** `src/features/likeness/hooks/useStartLikenessFlow.ts`

This hook orchestrates navigation to the likeness screen with proper context.

```typescript
export function useStartLikenessFlow() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  return useCallback(async (options?: StartLikenessFlowOptions) => {
    // 1. Store current location for return navigation
    const originPath = `${location.pathname}${location.search}` || "/"
    
    // 2. Determine starting step (1 or 3)
    let resolvedStep: StepParam | undefined = options?.initialStep
    
    if (!resolvedStep) {
      try {
        // Check if user already has saved likeness poses
        const cached = queryClient.getQueryData<LikenessPose[]>(likenessKeys.list())
        const poses = cached ?? 
          await queryClient.fetchQuery({
            queryKey: likenessKeys.list(),
            queryFn: () => listLikeness(),
          })
        
        // Skip to step 3 if poses exist, otherwise start at step 1
        resolvedStep = poses && poses.length > 0 ? "3" : "1"
      } catch (error) {
        console.error("[useStartLikenessFlow] failed to fetch poses", error)
        resolvedStep = "1" // Default to upload step on error
      }
    }
    
    // 3. Build navigation URL with outfit context
    const params = new URLSearchParams()
    params.set("step", resolvedStep ?? "1")
    params.set("returnTo", encodeURIComponent(originPath))
    
    // Attach outfit items (for try-on generation later)
    if (options?.outfitItems?.topId) {
      params.set("topId", options.outfitItems.topId)
    }
    if (options?.outfitItems?.bottomId) {
      params.set("bottomId", options.outfitItems.bottomId)
    }
    if (options?.outfitItems?.footwearId) {
      params.set("footwearId", options.outfitItems.footwearId)
    }
    
    // Attach outfit snapshot metadata
    if (options?.outfitSnapshot?.id) {
      params.set("outfitId", options.outfitSnapshot.id)
    }
    if (options?.outfitSnapshot?.name) {
      params.set("outfitName", options.outfitSnapshot.name)
    }
    if (options?.outfitSnapshot?.category) {
      params.set("outfitCategory", options.outfitSnapshot.category)
    }
    if (options?.outfitSnapshot?.occasionId) {
      params.set("outfitOccasion", options.outfitSnapshot.occasionId)
    }
    if (options?.outfitSnapshot?.backgroundId) {
      params.set("outfitBackgroundId", options.outfitSnapshot.backgroundId)
    }
    if (options?.outfitSnapshot?.gender) {
      params.set("outfitGender", options.outfitSnapshot.gender)
    }
    
    // 4. Navigate to likeness screen
    navigate(`/studio/likeness?${params.toString()}`)
  }, [location.pathname, location.search, navigate, queryClient])
}
```

**Key Features:**
- Checks cache first, then fetches if needed
- Smart step resolution (skip to step 3 if poses exist)
- Preserves full outfit context in URL params
- Stores return path for navigation after completion

---

### Phase 3: Likeness Screen - Three Steps

#### Component: `LikenessScreen`
**Location:** `src/features/likeness/LikenessScreen.tsx`

The screen manages a 3-step wizard flow with state management for photo uploads, candidate selection, and pose management.

**Current Implementation Notes:**
- ✅ **Background Progress Tracking System** - Global `JobsContext` tracks all background jobs
- ✅ **FloatingProgressHub** - UI component shows real-time progress and job status
- ✅ **Database Persistence** - All candidates stored in `likeness_candidates` table
- ✅ **Non-blocking Flow** - Users can navigate away during generation
- ✅ **Real-time Updates** - Progress polling every 4 seconds from database

**Actual Flow:**
The screen uses a **database-persistence model** with background job tracking. Users receive **instant feedback** via temp job creation, then can **browse freely** while generation completes in the background. The FloatingProgressHub shows real-time progress (0-100%) and notifications when ready.

---

#### **Step 1: Photo Upload**
User uploads two photos:
- Full body photo (standing, neutral pose)
- Face selfie (for identity capture)

**Component:** `StepOneForm` (rendered in LikenessScreen)

```typescript
const handleGenerateLikeness = useCallback(async () => {
  const values = form.getValues()
  
  if (!values.fullBodyPhoto || !values.faceSelfiePhoto) {
    toast({
      title: "Missing photos",
      description: "Please upload both a full body photo and a selfie.",
      variant: "destructive",
    })
    return
  }
  
  try {
    setHasStartedFlow(true)
    
    // Upload to backend for processing
    const response = await uploadMutation.mutateAsync({
      fullBody: values.fullBodyPhoto,
      selfie: values.faceSelfiePhoto,
      candidateCount: 2,        // Generate 2 candidate poses
      parallelStreams: 1,       // Processing concurrency
    })
    
    // Store batch ID for candidate retrieval
    setActiveBatchId(response.uploadBatchId)
    
    // Move to step 2 (candidate selection)
    updateStep(2)
  } catch (error) {
    toast({
      title: "Upload failed",
      description: error instanceof Error ? error.message : "Unable to generate likeness.",
      variant: "destructive",
    })
  }
}, [form, toast, uploadMutation, updateStep])
```

**Backend Processing** (`likeness-upload` edge function):
**Location:** `supabase/functions/likeness-upload/index.ts`

1. **Receives photos via `multipart/form-data`:**
   - `selfie`: File (JPEG/PNG/HEIC, max 30MB)
   - `fullBody`: File (JPEG/PNG/HEIC, max 30MB)
   - Optional: `height`, `weight`, `skinTone`, `candidateCount`, `uploadBatchId`

2. **Validates files:**
   - Checks MIME types (allowed: `image/jpeg`, `image/png`, `image/heic`, `image/heif`)
   - Validates file sizes (< 30MB)

3. **Uploads to Supabase Storage:**
   - Stores in `temp-candidates` bucket
   - Path: `{userId}/{batchId}/sources/selfie.{ext}` and `fullbody.{ext}`

4. **Calls AI model (Gemini):**
   - **Stage 1:** Extracts identity features from selfie
   - Generates identity summary with user characteristics
   - **Stage 2:** Creates neutral pose candidates from full body photo
   - Parallel generation based on `parallelStreams` parameter

5. **Stores candidates in database:**
   - **NEW:** Inserts each candidate into `likeness_candidates` table
   - Includes: batch_id, candidate_index, storage_path, mime_type, identity_summary
   - Candidates also saved as PNG in `temp-candidates` bucket
   - Path: `{userId}/{batchId}/candidates/01.png`, `02.png`, etc.

6. **Returns response:**
```typescript
{
  batchId: string,                    // UUID for this batch (for querying)
  message: string                     // Success message
}
```

7. **Frontend creates temp job immediately:**
```typescript
// LikenessScreen.tsx - handleGenerateLikeness
const tempJobId = `temp-likeness-${Date.now()}`
addJob({
  id: tempJobId,
  type: "likeness",
  status: "processing",
  progress: 0,
  metadata: { 
    batchId: response.batchId,
    expectedCount: 2,
    outfitParams: { /* preserved from URL */ }
  },
})
```

**Important:** 
- Candidates are now **persisted in database**, not just cache
- Frontend gets instant feedback via temp job
- `FloatingProgressHub` polls for progress every 4 seconds
- Users can navigate away - no blocking

#### **Step 2: Candidate Selection**
User reviews 2 generated neutral pose candidates and selects the best one.

**Component:** `StepTwoForm` (rendered in LikenessScreen)

**Candidate Retrieval** (`likeness-get-batch` edge function & `useLikenessBatchQuery` hook):
**Location:** 
- Edge function: `supabase/functions/likeness-get-batch/index.ts`
- Hook: `src/features/likeness/hooks/useLikenessBatchQuery.ts`

**NEW Database-Driven Approach:**

```typescript
// Edge function: likeness-get-batch
export async function handler(req: Request) {
  const { batchId } = await req.json()
  
  // Query database for candidates
  const { data: candidates, error } = await supabaseClient
    .from('likeness_candidates')
    .select('*')
    .eq('batch_id', batchId)
    .eq('user_id', userId)
    .order('candidate_index', { ascending: true })
  
  if (error) throw error
  
  // Generate signed URLs for each candidate
  const candidatesWithUrls = await Promise.all(
    candidates.map(async (candidate) => {
      const { data: signedData } = await supabaseClient.storage
        .from('temp-candidates')
        .createSignedUrl(candidate.storage_path, 3600)  // 1 hour expiry
      
      return {
        id: candidate.id,
        candidateIndex: candidate.candidate_index,
        storagePath: candidate.storage_path,
        signedUrl: signedData?.signedUrl,
        identitySummary: candidate.identity_summary,
      }
    })
  )
  
  return new Response(JSON.stringify({ candidates: candidatesWithUrls }))
}

// Frontend hook
export function useLikenessBatchQuery(batchId: string | null) {
  return useQuery({
    queryKey: likenessKeys.batch(batchId),
    enabled: Boolean(batchId),
    queryFn: async () => {
      if (!batchId) return null
      
      const { data, error } = await supabase.functions.invoke('likeness-get-batch', {
        body: { batchId }
      })
      
      if (error) throw error
      return data.candidates
    },
    // Refetch every 5 seconds while candidates are loading
    refetchInterval: (data) => !data || data.length === 0 ? 5000 : false,
  })
}
```

**Key Differences from OLD Approach:**
- ❌ **OLD:** Cache-only strategy (no server fetch after initial upload)
- ✅ **NEW:** Database-driven with `likeness-get-batch` edge function
- ❌ **OLD:** `likeness-sign-temp` endpoint to refresh expired URLs
- ✅ **NEW:** Fresh signed URLs generated on each `likeness-get-batch` call
- ❌ **OLD:** Blocking UI during generation
- ✅ **NEW:** Non-blocking with background progress tracking
      // Call backend to get fresh signed URL
      const signedUrl = await signTempCandidate(path)
      
      // Update cache with new URL
      queryClient.setQueryData<LikenessUploadResponse | undefined>(
        likenessKeys.candidates(batchId), 
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            candidates: prev.candidates.map((candidate) =>
              candidate.path === path ? { ...candidate, signedUrl } : candidate
            ),
          }
        }
      )
      return signedUrl
    },
    [batchId, queryClient],
  )

  return {
    batchId,
    candidates: cached.data?.candidates ?? [],
    identitySummary: cached.data?.identitySummary ?? null,
    metadata: cached.data?.metadata ?? {},
    refreshCandidate,  // For refreshing expired URLs
  }
}
```

**Why Cache-Only?**
- Upload mutation (`useLikenessUploadMutation`) sets candidate data in cache via `onSuccess`
- Candidates are temporary and only exist during the selection flow
- No backend endpoint for retrieving candidates by batchId after the fact
- Signed URLs can be refreshed individually if they expire (1-hour lifetime)
- This is a **non-standard** pattern - normally queries fetch from server

**Candidate Selection:**
```typescript
const handleSaveCandidate = useCallback(
  async (candidateIndex: number) => {
    if (!activeBatchId) {
      toast({
        title: "No batch",
        description: "Please generate candidates first.",
        variant: "destructive",
      })
      return
    }
    
    try {
      // Save selected candidate as permanent neutral pose
      await selectMutation.mutateAsync({
        uploadBatchId: activeBatchId,
        candidateIndex,
        setActive: true,  // Mark as active pose for try-on
      })
      
      // Reset form and clear batch
      setActiveBatchId(null)
      form.reset({
        fullBodyPhoto: null,
        faceSelfiePhoto: null,
      })
      
      // Move to step 3 (saved poses list)
      updateStep(3)
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unable to save the selected candidate.",
        variant: "destructive",
      })
    }
  },
  [activeBatchId, form, selectMutation, toast, updateStep],
)
```

**Backend Processing** (`likeness-select` edge function):
**Location:** `supabase/functions/likeness-select/index.ts`

1. **Validates request:**
   ```typescript
   {
     uploadBatchId: string,
     candidateIndex: number,
     setActive?: boolean
   }
   ```

2. **Fetches candidate from temp storage:**
   - Downloads candidate PNG from `temp-candidates/{userId}/{batchId}/candidates/{index}.png`
   - Downloads metadata JSON from `temp-candidates/{userId}/{batchId}/metadata.json`

3. **Creates permanent storage:**
   - Uploads to `neutral-poses` bucket
   - Path: `{userId}/{poseId}.png`
   - Generates signed URL (15-minute expiry)

4. **Inserts database record:**
   ```sql
   INSERT INTO user_neutral_poses (
     id, user_id, storage_path, 
     original_fullbody_path, original_selfie_path,
     status, is_active, metadata
   ) VALUES (
     poseId, userId, finalPath,
     fullBodySourcePath, selfieSourcePath,
     'ready', false, poseMetadata
   )
   ```

5. **Sets active pose (if requested):**
   ```sql
   -- Clear all active poses for user
   UPDATE user_neutral_poses 
   SET is_active = false 
   WHERE user_id = userId;
   
   -- Set new pose as active
   UPDATE user_neutral_poses 
   SET is_active = true 
   WHERE id = poseId;
   ```

6. **Cleanup temp storage:**
   - Deletes candidate PNGs
   - Deletes source images (selfie, fullBody)
   - Deletes metadata JSON

7. **Returns response:**
   ```typescript
   {
     status: "ok",
     neutralPoseId: string,
     storagePath: string,
     imageUrl: string | null,        // Signed URL for immediate display
     identitySummary: string | null,
     isActive: boolean,
     correlationId: string
   }
   ```

8. **Frontend cache invalidation:**
```typescript
// useLikenessSelectMutation.ts
export function useLikenessSelectMutation() {
  const queryClient = useQueryClient()
  
  return useMutation<LikenessSelectResponse, Error, SelectVariables>({
    mutationKey: likenessKeys.select(),
    mutationFn: (variables) => selectLikeness(variables),
    onSuccess: (_data, variables) => {
      // Refresh poses list
      queryClient.invalidateQueries({ queryKey: likenessKeys.list() })
      
      // Remove temp candidates from cache
      if (variables?.uploadBatchId) {
        queryClient.removeQueries({ 
          queryKey: likenessKeys.candidates(variables.uploadBatchId) 
        })
      }
    },
  })
}
```

#### **Step 3: Manage Saved Poses & Generate Try-On**
User can:
- View all saved likeness poses (via `useLikenessListQuery`)
- Set a different pose as active (via `useLikenessSetActiveMutation`)
- Generate new poses (returns to Step 1)
- **Start try-on with selected outfit** (primary action)

**Component:** `StepThreeForm` (rendered in LikenessScreen)

**Fetching Saved Poses:**
**Location:** `src/features/likeness/hooks/useLikenessListQuery.ts`

```typescript
export function useLikenessListQuery() {
  return useQuery({
    queryKey: likenessKeys.list(),
    queryFn: () => listLikeness(),
    staleTime: 60_000,  // 1 minute
  })
}

// Service: src/services/likeness/likenessService.ts
export async function listLikeness(): Promise<LikenessPose[]> {
  const headers = await buildAuthHeaders()
  const result = await fetchJson<{ poses: LikenessPose[] }>("likeness-list", {
    method: "GET",
    headers,
  })
  return Array.isArray(result.poses) ? result.poses : []
}
```

**Backend:** `likeness-list` edge function fetches all user poses from `user_neutral_poses` table with signed URLs.

**Try-On Generation Flow:**
```typescript
const handleUseAvatar = useCallback(
  async (poseId: string) => {
    // 1. Validate outfit items exist
    if (!outfitItems.topId && !outfitItems.bottomId && !outfitItems.footwearId) {
      toast({
        title: "No outfit items",
        description: "Select at least one garment in Studio before starting a try-on.",
        variant: "destructive",
      })
      return
    }
    
    try {
      // 2. Set pose as active
      await setActiveMutation.mutateAsync(poseId)
      
      // 3. Ensure garment summaries exist (physics/mesh data)
      await ensureSummariesMutation.mutateAsync([
        outfitItems.topId, 
        outfitItems.bottomId, 
        outfitItems.footwearId
      ])
      
      // 4. Generate try-on
      await generateTryOnMutation.mutateAsync({
        neutralPoseId: poseId,
        outfitItems,
        outfitSnapshot: outfitSnapshot ?? undefined,
      })
      
      toast({
        title: "Try-on ready",
        description: "Check Generations to view the new look.",
      })
      
      // Return to studio
      handleClose()
    } catch (error) {
      toast({
        title: "Try-on failed",
        description: error instanceof Error ? error.message : "Unable to start try-on.",
        variant: "destructive",
      })
    }
  },
  [
    ensureSummariesMutation, 
    generateTryOnMutation, 
    handleClose, 
    outfitItems, 
    outfitSnapshot,
    setActiveMutation, 
    toast
  ]
)
```

**Set Active Pose:**
```typescript
// Hook: useLikenessSetActiveMutation
export function useLikenessSetActiveMutation() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationKey: likenessKeys.setActive(),
    mutationFn: (poseId: string) => setActiveLikeness(poseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: likenessKeys.list() })
    },
  })
}

// Service
export async function setActiveLikeness(poseId: string) {
  const headers = await buildAuthHeaders()
  await fetchJson("likeness-set-active", {
    method: "POST",
    headers,
    body: JSON.stringify({ poseId }),
  })
}
```

**Backend:** `likeness-set-active` edge function updates database to set `is_active = true` for the specified pose (and `false` for all others).

---

### Phase 4: Asset Preparation

#### Hook: `useEnsureSummaries`
**Location:** `src/features/tryon/hooks/useEnsureSummaries.ts`

Before try-on generation, garments need physics/mesh summaries for realistic rendering.

```typescript
export function useEnsureSummaries() {
  return useMutation({
    mutationKey: tryOnKeys.ensureSummaries(),
    mutationFn: async (productIds: Array<string | null | undefined>) => {
      // Filter to unique, non-null product IDs
      const uniqueIds = uniqueProductIds(productIds)
      if (!uniqueIds.length) return []
      
      // Generate summaries for all products in parallel
      return Promise.all(uniqueIds.map((id) => ensureGarmentSummary(id)))
    },
  })
}

// Service: src/services/tryon/tryonService.ts
export async function ensureGarmentSummary(productId: string) {
  const headers = await buildAuthHeaders()
  return fetchJson<TryOnEnsureResponse>("tryon-generate-summary", {
    method: "POST",
    headers,
    body: JSON.stringify({ productId }),
  })
}

export type TryOnEnsureResponse = {
  status: "ok"
  productId: string
  version: string
  physicsBlock: string | null
  correlationId: string
}
```

**Backend Processing** (`tryon-generate-summary` edge function):
**Location:** `supabase/functions/tryon-generate-summary/index.ts`

1. **Checks if product already has summary:**
   ```sql
   SELECT garment_summary_front, garment_summary_version 
   FROM products 
   WHERE id = productId
   ```

2. **If version matches current (`GARMENT_SUMMARY_VERSION`), returns existing summary**

3. **If not, generates new summary:**
   - Fetches product images (front view preferred, via `selectFrontEligibleImage`)
   - Calls AI model (Gemini) to analyze:
     - Garment type and structure
     - Fabric physics properties (drape, stretch, stiffness)
     - Mesh deformation parameters
     - Occlusion zones
     - Layering order

4. **Stores summary:**
   ```sql
   UPDATE products 
   SET garment_summary_front = summary,
       garment_summary_version = GARMENT_SUMMARY_VERSION
   WHERE id = productId
   ```

5. **Returns summary data:**
   ```typescript
   {
     status: "ok",
     productId: string,
     version: string,
     physicsBlock: string | null,  // Extracted from summary
     correlationId: string
   }
   ```

**Key Points:**
- Summaries are versioned to allow regeneration when model improves
- Multiple products processed in parallel for efficiency
- Summary stored in database for reuse across all try-ons

---

### Phase 5: Try-On Generation

#### Hook: `useGenerateTryOn`
Located in: `src/features/tryon/hooks/useGenerateTryOn.ts`

```typescript
export function useGenerateTryOn() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationKey: tryOnKeys.generate(),
    mutationFn: (payload: TryOnGeneratePayload) => generateTryOn(payload),
    onSuccess: (data: TryOnGenerateResponse) => {
      // Invalidate relevant caches
      queryClient.invalidateQueries({ queryKey: tryOnKeys.list() })
      queryClient.invalidateQueries({ queryKey: tryOnKeys.generation(data.generationId) })
      queryClient.invalidateQueries({ queryKey: likenessKeys.list() })
    },
  })
}
```

#### Service: `generateTryOn`
Located in: `src/services/tryon/tryonService.ts`

```typescript
export async function generateTryOn(payload: TryOnGeneratePayload) {
  const headers = await buildAuthHeaders()
  
  return fetchJson<TryOnGenerateResponse>("tryon-generate", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
}

// Payload structure
export type TryOnGeneratePayload = {
  neutralPoseId: string              // Active likeness pose ID
  outfitItems: {
    topId?: string | null            // Product IDs
    bottomId?: string | null
    footwearId?: string | null
  }
  outfitSnapshot?: {                 // Full outfit context
    id: string
    name?: string | null
    category?: string | null
    occasion?: string | null
    background_id?: string | null
    gender?: string | null
    top_id?: string | null
    bottom_id?: string | null
    shoes_id?: string | null
  } | null
  generationId?: string | null       // For retries
}
```

**Backend Processing** (`tryon-generate` edge function):
**Location:** `supabase/functions/tryon-generate/index.ts`

1. **Validation:**
   - Verify user owns neutral pose
   - Check at least one garment provided
   - Validate garment summaries exist (calls `ensureSummary` internally if missing)

2. **Fetch Assets:**
   ```typescript
   // Fetch neutral pose image
   const pose = await fetchNeutralPose(adminClient, userId, neutralPoseId)
   // Returns: { path: string, signedUrl: string }
   
   // Fetch product data with summaries
   const products = await fetchProductRows(adminClient, [topId, bottomId, footwearId])
   // Returns array with garment_summary_front for each product
   ```

3. **Database Record Creation:**
   ```sql
   INSERT INTO user_generations (
     id, user_id, neutral_pose_id, outfit_id, 
     status, storage_path, metadata
   ) VALUES (
     generationId, userId, poseId, outfitId,
     'queued', '', metadata
   )
   ```

4. **Build AI Prompt:**
   - Chooses prompt template based on garments:
     - `topbottom`: Top + Bottom (most common)
     - `onepiece`: Top/Bottom + Footwear
     - `single`: Only one garment
   - Builds summaries block with physics data:
     ```
     Top Garment:
     {garment_summary_front physics data}
     
     Bottom Garment:
     {garment_summary_front physics data}
     ```

5. **AI Model Invocation (Gemini):**
   ```typescript
   const parts = [
     { text: promptTemplate },
     toInlineImagePartFromUrl(pose.signedUrl),  // Neutral pose
     toInlineImagePartFromUrl(topImageUrl),     // Top garment
     toInlineImagePartFromUrl(bottomImageUrl),  // Bottom garment
     { text: summariesBlock }                   // Physics data
   ]
   
   const response = await model.generateContent({
     contents: [{ role: 'user', parts }],
     generationConfig: {
       temperature: TRYON_STAGE2_TEMPERATURE,
       topK: TRYON_STAGE2_TOP_K,
       responseMimeType: "image/png"
     }
   })
   ```

6. **Process AI Response:**
   - Extracts base64-encoded PNG from response
   - Converts to bytes
   - Validates image data

7. **Result Storage:**
   ```typescript
   // Upload to 'generations' bucket
   const storagePath = `${userId}/${generationId}.png`
   await putObject(GENERATIONS_BUCKET, storagePath, imageBytes, "image/png")
   
   // Generate signed URL (15-minute expiry)
   const signed = await createSignedUrl(GENERATIONS_BUCKET, storagePath, 900)
   ```

8. **Update Database:**
   ```sql
   UPDATE user_generations 
   SET status = 'ready', 
       storage_path = storagePath,
       updated_at = NOW()
   WHERE id = generationId
   ```

9. **Response:**
   ```typescript
   {
     status: "ready",
     generationId: string,
     outfitId: string,
     storagePath: string,
     signedUrl: string | null,  // For immediate display
     correlationId: string
   }
   ```

**Error Handling:**
- If generation fails, sets `status = 'failed'` in database
- Returns error code in response (e.g., `E_POSE_NOT_FOUND`, `E_NO_OUTFIT_ITEMS`, `E_MODEL_GENERATION_FAILED`)
- Frontend displays error toast with description

---

### Phase 5.5: Background Job Tracking & Progress Hub

#### Global Job Tracker: `JobsContext`
**Location:** `src/features/progress/providers/JobsContext.tsx`

Provides global state management for all background jobs (likeness generation, try-on generation).

**Key Features:**
- **Real-time Progress Updates:** Polls database every 4 seconds
- **localStorage Persistence:** Jobs survive page refresh (30-minute TTL)
- **Automatic Cleanup:**
  - Stale jobs (>30 min) removed
  - Stuck jobs (>10 min in processing) marked as failed
  - Temp jobs (>5 min never updated) removed
- **Smart Storage:** Keeps only active jobs + last 5 completed

**Job Structure:**
```typescript
type Job = {
  id: string                      // Job ID or generationId
  type: "likeness" | "tryon"      // Job type
  status: "processing" | "ready" | "failed"
  startedAt: number               // Timestamp
  progress?: number               // 0-100 real progress from DB
  thumbnail?: string              // Signed URL preview
  metadata?: {
    batchId?: string              // For likeness jobs
    generationId?: string         // For try-on jobs
    expectedCount?: number        // For likeness (# of candidates)
    outfitParams?: Record<string, string>  // Preserved outfit context
    [key: string]: any
  }
}
```

**Progress Calculation:**
```typescript
// Likeness progress: based on candidates ready
const progress = (candidatesReady / expectedCount) * 100

// Try-on progress: based on database status
const progressMap = {
  'queued': 20,
  'generating': 60,
  'completed': 100,
  'ready': 100,
  'failed': 0,
}
```

**Temp Job Pattern:**
```typescript
// 1. Create temp job immediately (instant feedback)
const tempId = `temp-tryon-${Date.now()}`
addJob({
  id: tempId,
  type: "tryon",
  status: "processing",
  progress: 0,
  metadata: { generationId: tempId },
})

// 2. Start async operation
const result = await generateTryOn(payload)

// 3. Update temp job with real ID when async completes
updateJob(tempId, {
  id: result.generationId,
  metadata: { generationId: result.generationId },
  progress: 30,
})
```

**Key Functions:**
- `addJob(job)` - Add new job to tracker
- `updateJob(id, updates)` - Update existing job
- `removeJob(id)` - Remove job from tracker
- `getJobById(id)` - Get specific job
- `processingCount` - Count of active jobs
- `readyCount` - Count of completed jobs

#### FloatingProgressHub Component
**Location:** `src/features/progress/components/FloatingProgressHub.tsx`

Persistent UI overlay showing job progress in bottom-right corner.

**Features:**
- **Collapsed State:** Shows count of processing/ready jobs
- **Expanded State:** Full job list with details
- **Real-time Thumbnails:** From `generations` storage bucket with signed URLs
- **Sorted Display:**
  - Active jobs (newest first)
  - Recent completed jobs (last 5, newest first)
- **Navigation:** Click "View Result" to navigate to:
  - Likeness: `/studio/likeness?step=2&batchId={id}`
  - Try-on: `/home?moodboard=try-ons`

**Job Card Display:**
```typescript
// Active jobs section
<div className="text-xs font-semibold">Active ({activeCount})</div>
{activeJobs.map(job => (
  <JobCard
    job={job}
    showProgress={true}          // 0-100% progress bar
    showThumbnail={job.thumbnail} // If available
    showActions={["remove"]}     // X button to dismiss
  />
))}

// Recent completed jobs section  
<div className="text-xs font-semibold">Recent ({completedCount})</div>
{completedJobs.map(job => (
  <JobCard
    job={job}
    showThumbnail={job.thumbnail}
    showActions={["view", "remove"]} // View Result + X button
  />
))}
```

**Toast Notifications:**
When jobs complete, shows toast with "View" button:
```typescript
toast.success("Your outfit is ready", {
  duration: 5000,
  action: {
    label: "View",
    onClick: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["tryon"] })
      queryClient.invalidateQueries({ queryKey: ["generations"] })
      
      // Navigate only when user clicks
      if (job.type === "tryon") {
        window.location.href = "/home?moodboard=try-ons"
      }
    },
  },
})
```

**Non-Blocking Flow:**
- User clicks "Try On" → temp job created → continues browsing
- Generation runs in background → progress hub shows updates
- When ready → toast notification appears
- User clicks "View" → navigates to results

**Edge Cases Handled:**
- Stuck jobs (>10 min) automatically marked as failed
- Object not found errors (file not ready) - keeps polling
- Temp jobs that never update - cleaned up after 5 min
- Page refresh - jobs restored from localStorage
- Network errors - retries on next poll cycle

---

### Phase 6: Viewing Results

#### Generations Screen
**Location:** `src/components/generations/GenerationsScreen.tsx`

Users can view all their try-on generations with filtering and pagination.

**Fetching Generations:**
```typescript
// Direct Supabase query (not through service layer yet)
const { data, error } = await supabase
  .from('user_generations')
  .select('id, user_id, storage_path, outfit_id, status, created_at')
  .order('created_at', { ascending: false })
  .range(from, to)  // Pagination
```

**Generation Record Structure:**
```typescript
type GenerationRow = {
  id: string                    // UUID
  user_id: string               // Owner
  storage_path: string | null   // Path in 'generations' bucket
  outfit_id: string | null      // Optional outfit reference
  status: 'queued' | 'generating' | 'ready' | 'failed'
  created_at?: string           // ISO timestamp
}
```

**Features:**
- **Status Filtering:** Filter by all/ready/generating/queued/failed
- **Pagination:** 24 generations per page
- **Image Viewer:** Lightbox with navigation
- **Signed URLs:** Generated on-the-fly for display (3600s expiry)
- **Collections Integration:** Favorited generations shown in "Generations" collection tab

**User Actions:**
- View generation in lightbox
- Delete generation
- Navigate through generations with keyboard/swipe
- Filter by status
- Switch between images/outfits tabs
const { data, error } = await supabase
  .from('user_generations')
  .select('id, created_at, status, storage_path, metadata')
  .order('created_at', { ascending: false })
```

**Generation Record Structure**:
```typescript
{
  id: string                    // UUID
  created_at: string            // ISO timestamp
  status: "queued" | "generating" | "ready" | "failed"
  storage_path: string | null   // Supabase storage path
  metadata: {
    neutralPoseId: string
    topId?: string
    bottomId?: string
    shoesId?: string
    outfitId?: string
    error?: string              // If failed
  }
}
```

Users can:
- View all generations
- Delete generations
- Share successful try-ons
- Regenerate failed attempts

---

## State Management Flow

### Job Status Tracking

#### Hook: `useLikenessJobStatus`
**Location:** `src/features/likeness/hooks/useLikenessJobStatus.ts`

Tracks the overall state of likeness workflow for UI feedback.

```typescript
export type LikenessJobState = 
  | "idle"              // No active job
  | "processing"        // Uploading or generating candidates
  | "awaiting_review"   // Candidates ready for selection
  | "saving"            // Saving selected candidate
  | "saved"             // Neutral pose saved (has poses)
  | "error"             // Something failed

export function useLikenessJobStatus({ 
  uploadStatus, 
  selectStatus, 
  hasSavedPoses 
}: JobStatusInput): LikenessJobState {
  return useMemo(() => {
    if (uploadStatus === "pending") {
      return "processing"
    }
    if (uploadStatus === "error" || selectStatus === "error") {
      return "error"
    }
    if (selectStatus === "pending") {
      return "saving"
    }
    if (uploadStatus === "success" && selectStatus === "idle") {
      return "awaiting_review"
    }
    if (hasSavedPoses) {
      return "saved"
    }
    return "idle"
  }, [uploadStatus, selectStatus, hasSavedPoses])
}
```

**Used for:**
- Status chip display in LikenessScreen
- Conditional UI rendering
- Progress feedback during generation

### Query Keys Organization

#### Likeness Keys
**Location:** `src/features/likeness/queryKeys.ts`

```typescript
export const likenessKeys = {
  all: ["likeness"] as const,
  list: () => [...likenessKeys.all, "list"] as const,
  upload: () => [...likenessKeys.all, "upload"] as const,
  setActive: () => [...likenessKeys.all, "set-active"] as const,
  select: () => [...likenessKeys.all, "select"] as const,
  delete: () => [...likenessKeys.all, "delete"] as const,
  candidates: (batchId: string) => [...likenessKeys.all, "candidates", batchId] as const,
  candidatesStatus: (batchId: string | null) =>
    batchId ? likenessKeys.candidates(batchId) : [...likenessKeys.all, "candidates", "noop"] as const,
  detail: (poseId: string) => [...likenessKeys.all, "detail", poseId] as const,
  jobs: () => [...likenessKeys.all, "jobs"] as const,
}
```

#### Try-On Keys
**Location:** `src/features/tryon/queryKeys.ts`

```typescript
export const tryOnKeys = {
  all: ["tryon"] as const,
  ensure: (productId: string) => [...tryOnKeys.all, "ensure", productId] as const,
  ensureSummaries: () => [...tryOnKeys.all, "ensure-summaries"] as const,
  generate: () => [...tryOnKeys.all, "generate"] as const,
  generation: (generationId: string) => [...tryOnKeys.all, "generation", generationId] as const,
  generationStatus: (generationId: string | null) =>
    generationId ? tryOnKeys.generation(generationId) : [...tryOnKeys.all, "generation", "noop"] as const,
  list: () => [...tryOnKeys.all, "list"] as const,
}
```

**Invalidation Strategy:**
- After `generateTryOn`: Invalidates `tryOnKeys.list()`, specific generation, and `likenessKeys.list()`
- After `selectLikeness`: Invalidates `likenessKeys.list()`, removes temp candidates
- After `setActiveLikeness`: Invalidates `likenessKeys.list()`

---

## Error Handling Strategy

### Frontend Error Handling
**Pattern used throughout all mutations:**

```typescript
try {
  await operation()
} catch (error) {
  const message = error instanceof Error 
    ? error.message 
    : "Operation failed"
  
  toast({
    title: "Error Title",
    description: message,
    variant: "destructive",
  })
}
```

### Backend Error Codes
Edge functions return structured error codes in JSON:

**Common Codes:**
- `E_UNAUTHORIZED` / `UNAUTHORIZED`: User not authenticated
- `E_BAD_REQUEST` / `INVALID_INPUT`: Validation failed
- `E_METHOD_NOT_ALLOWED`: Wrong HTTP method
- `E_POSE_NOT_FOUND` / `POSE_NOT_FOUND`: Neutral pose doesn't exist
- `E_POSE_NOT_READY`: Pose exists but status isn't 'ready'
- `E_NO_OUTFIT_ITEMS`: No garments provided for try-on
- `E_MODEL_GENERATION_FAILED` / `GENERATION_FAILED`: AI model error
- `E_DB_INSERT`: Database insertion failed
- `E_SELECT_FAILED`: Candidate selection failed
- `MISSING_SELFIE` / `MISSING_FULLBODY`: Required photo not provided
- `EMPTY_FILE`: Upload file is empty
- `FILE_TOO_LARGE`: Upload exceeds 30MB limit
- `UNSUPPORTED_MIME`: File type not allowed
- `UNSUPPORTED_CONTENT_TYPE`: Request not multipart/form-data
- `MISSING_SOURCE_PATHS`: Original source images not found

**Error Response Format:**
```typescript
{
  status: "error",
  code: "ERROR_CODE",
  message?: string  // Optional human-readable message
}
```

---

## Performance Optimizations

### 1. Parallel Summary Generation
**Location:** `useEnsureSummaries` hook

Multiple garment summaries generated simultaneously for efficiency:
```typescript
return Promise.all(uniqueIds.map((id) => ensureGarmentSummary(id)))
```

### 2. Cached Likeness List Check
**Location:** `useStartLikenessFlow` hook

Avoids unnecessary server round-trip by checking cache first:
```typescript
const cached = queryClient.getQueryData<LikenessPose[]>(likenessKeys.list())
const poses = cached ?? await queryClient.fetchQuery({
  queryKey: likenessKeys.list(),
  queryFn: () => listLikeness(),
})
```

### 3. Stale-While-Revalidate
**Location:** `useLikenessListQuery`

Queries use stale time for immediate display with background updates:
```typescript
useQuery({
  queryKey: likenessKeys.list(),
  queryFn: () => listLikeness(),
  staleTime: 60_000,  // 1 minute
})
```

### 4. Temporary Signed URLs with Refresh
**Location:** Candidates in Step 2

- Candidates use 1-hour signed URLs from temp storage
- Individual URL refresh available via `refreshCandidate()` if expired
- Avoids re-generating entire batch if user takes time selecting

### 5. Cache-Only Candidate Retrieval
**Location:** `useLikenessCandidates`

- No server fetch for candidates (already cached by upload mutation)
- Reduces latency transitioning from Step 1 → Step 2
- Candidates automatically cleaned up after selection

### 6. Mutation-Based Cache Updates
**Pattern:** `onSuccess` callbacks in mutations

Direct cache updates without refetch:
```typescript
onSuccess: (data) => {
  queryClient.setQueryData(likenessKeys.candidates(data.uploadBatchId), data)
}
```

### 7. Timer-Based UI Feedback
**Location:** LikenessScreen

60-second countdown provides progress feedback during blocking generation (no actual polling of backend status).

---

## Data Flow Diagram

```
┌──────────────┐
│ StudioScreen │
│ (User clicks │
│   Try-On)    │
└──────┬───────┘
       │
       ▼
┌─────────────────────────┐
│ resolveTryOnSnapshot()  │
│ (Create/use outfit)     │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ startLikenessFlow()     │
│ (Check for poses)       │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│   LikenessScreen        │
│                         │
│  ┌─────────────────┐    │
│  │ Step 1: Upload  │    │
│  │ - Full body     │    │
│  │ - Selfie        │    │
│  └────────┬────────┘    │
│           │             │
│           ▼             │
│  ┌─────────────────┐    │
│  │ likeness-upload │    │ Backend
│  │ (AI generates   │    │ Edge Function
│  │  candidates)    │    │
│  └────────┬────────┘    │
│           │             │
│           ▼             │
│  ┌─────────────────┐    │
│  │ Step 2: Select  │    │
│  │ - Review 2-3    │    │
│  │   candidates    │    │
│  │ - Pick best     │    │
│  └────────┬────────┘    │
│           │             │
│           ▼             │
│  ┌─────────────────┐    │
│  │ likeness-select │    │ Backend
│  │ (Save to DB)    │    │ Edge Function
│  └────────┬────────┘    │
│           │             │
│           ▼             │
│  ┌─────────────────┐    │
│  │ Step 3: Manage  │    │
│  │ - View poses    │    │
│  │ - Set active    │    │
│  │ - Generate!     │◄───┼─── outfitItems from URL
│  └────────┬────────┘    │
└───────────┼─────────────┘
            │
            ▼
    ┌───────────────────┐
    │ ensureSummaries() │
    │ (Parallel garment │
    │  analysis)        │
    └───────┬───────────┘
            │
            ▼
    ┌────────────────────────┐
    │ tryon-generate-summary │  Backend (per garment)
    │ - Physics analysis     │  Edge Function
    │ - Mesh parameters      │
    └───────┬────────────────┘
            │
            ▼
    ┌───────────────────┐
    │ generateTryOn()   │
    └───────┬───────────┘
            │
            ▼
    ┌────────────────────┐
    │ tryon-generate     │  Backend
    │ - Composite image  │  Edge Function
    │ - Apply physics    │
    │ - Save to storage  │
    └───────┬────────────┘
            │
            ▼
    ┌───────────────────┐
    │ user_generations  │  Database
    │ (status: ready)   │  Record
    └───────┬───────────┘
            │
            ▼
    ┌───────────────────┐
    │ GenerationsScreen │  User views
    │ (Display result)  │  their try-on
    └───────────────────┘
```

---

## Key Takeaways

### Current Implementation Status

**✅ Fully Implemented:**
- 3-step likeness flow (upload → select → manage)
- Multipart photo upload with validation
- AI-powered candidate generation (Gemini)
- Temporary candidate storage with signed URLs
- Permanent pose storage and management
- Active pose selection (one per user)
- Garment summary generation with versioning
- Try-on generation with physics-based rendering
- Generation history with status tracking
- Cache-first candidate retrieval strategy
- Query key factory organization
- Error handling with structured codes
- Toast notifications for user feedback

**❌ Not Yet Implemented (Mentioned in Original Doc):**
- `useLikenessProgress` hook for background tracking
- `LikenessProgressTracker` floating card component
- `getBatchStatus` API for polling generation status
- localStorage persistence for progress
- Non-blocking generation (users can navigate away)
- Service-based generations fetching (still using direct Supabase in component)

### Critical User Experience Decisions

1. **Two-Photo Upload:** Separate selfie and full body for better identity + pose quality
2. **Candidate Selection:** User picks best neutral pose from 2 candidates (configurable)
3. **Step Skipping:** Returns users to Step 3 if they already have saved poses
4. **Draft Outfits:** Creates temporary outfits for non-owners to enable try-on
5. **Return Navigation:** Stores origin path in URL to return user after completion
6. **Blocking Generation:** Current UX blocks user during Step 1 upload (60s timer feedback)
7. **Cache-Only Candidates:** Non-standard pattern avoids backend fetch for temporary data

### Architecture Highlights

1. **Separation of Concerns:** Services → Hooks → Components (new architecture)
2. **Query Key Factories:** Centralized cache management via `likenessKeys` and `tryOnKeys`
3. **Parallel Processing:** Summaries generated concurrently for all garments
4. **Error Boundaries:** Each phase handles failures gracefully with toast notifications
5. **Mutation-Based Updates:** Direct cache updates via `onSuccess` callbacks
6. **Temporary Storage:** Candidates in `temp-candidates` bucket, cleaned up after selection
7. **Permanent Storage:** Final poses in `neutral-poses` bucket with unique ID paths
8. **Versioned Summaries:** `garment_summary_version` allows regeneration when model improves
9. **Signed URL Strategy:** Short-lived URLs (15min-1hr) for security and cost optimization

### Database Constraints

1. **One Active Pose:** Unique index ensures `is_active = true` for only one pose per user
2. **Cascade Deletion:** User poses deleted when user account deleted
3. **Restrict Generation Deletion:** Can't delete pose if generations reference it
4. **RLS Policies:** Row-level security ensures users only access their own data

### Extensibility Points

1. **New Garment Types:** Add to slot types and update prompt selection logic
2. **Multiple Poses:** Already supported - UI shows all poses with active indicator
3. **Background Customization:** `outfitSnapshot.background_id` passed but not yet used in generation
4. **Batch Try-Ons:** Generate multiple outfits at once by parallelizing `generateTryOn` calls
5. **Social Sharing:** Enhanced metadata for social previews in `user_generations.metadata`
6. **Progress Tracking:** Foundation exists but needs implementation (noted as future work)
7. **Candidate Count:** Configurable via `candidateCount` parameter (currently 2, max 8)
8. **Parallel Streams:** Configurable concurrent generation (currently 1, defaults to 2)

---

## API Reference Summary

### Likeness Endpoints

| Endpoint | Method | Purpose | Input | Output |
|----------|--------|---------|-------|--------|
| `likeness-upload` | POST | Upload photos, generate candidates | FormData (selfie, fullBody, metadata) | `LikenessUploadResponse` |
| `likeness-select` | POST | Save candidate as permanent pose | `{ uploadBatchId, candidateIndex, setActive }` | `LikenessSelectResponse` |
| `likeness-list` | GET | Fetch all user poses | - | `{ poses: LikenessPose[] }` |
| `likeness-set-active` | POST | Set active pose | `{ poseId }` | Success status |
| `likeness-delete` | POST | Delete pose | `{ poseId }` | Success status |
| `likeness-sign-temp` | POST | Refresh temp URL | `{ path }` | `{ signedUrl }` |

### Try-On Endpoints

| Endpoint | Method | Purpose | Input | Output |
|----------|--------|---------|-------|--------|
| `tryon-generate-summary` | POST | Generate garment physics | `{ productId }` | `TryOnEnsureResponse` |
| `tryon-generate` | POST | Generate try-on image | `TryOnGeneratePayload` | `TryOnGenerateResponse` |

### Storage Buckets

| Bucket | Purpose | Lifecycle | Path Pattern |
|--------|---------|-----------|--------------|
| `temp-candidates` | Temporary candidate storage | Cleaned up after selection | `{userId}/{batchId}/candidates/{index}.png` |
| `neutral-poses` | Permanent pose storage | User-managed | `{userId}/{poseId}.png` |
| `generations` | Try-on result storage | User-managed | `{userId}/{generationId}.png` |

---

## Future Improvements (Documented but Not Implemented)

1. **Background Progress Tracking:**
   - `useLikenessProgress` hook with localStorage persistence
   - `LikenessProgressTracker` floating component
   - `getBatchStatus` polling API
   - Allow users to navigate away during generation

2. **Service Layer for Generations:**
   - Move `GenerationsScreen` to use service layer instead of direct Supabase queries
   - Implement `listGenerations()` and `getGeneration()` services consistently

3. **Enhanced Error Recovery:**
   - Retry failed generations
   - Resume interrupted uploads
   - Automatic cleanup of orphaned temp files

4. **Performance:**
   - Image optimization/compression before upload
   - Progressive loading of generations
   - Infinite scroll instead of pagination

5. **UX Enhancements:**
   - Side-by-side candidate comparison
   - Before/after slider in generations
   - Bulk operations (delete multiple generations)
   - Generation templates/presets

---

## Conclusion

This documentation represents the **actual current implementation** of the Virtual Try-On flow as of January 3, 2026. It captures the complete architecture from user trigger through AI generation to result display, including all database schemas, API signatures, frontend hooks, and state management patterns currently in use.

For implementation details of specific components, refer to the file paths indicated throughout this document.
            │
            ▼
    ┌───────────────────┐
    │ GenerationsScreen │  User views
    │ (Display result)  │  their try-on
    └───────────────────┘
```

---

## Key Takeaways

### Critical User Experience Decisions
1. **Two-Photo Upload**: Separate selfie and full body for better identity + pose quality
2. **Candidate Selection**: User picks best neutral pose from 2-3 options
3. **Step Skipping**: Returns users to Step 3 if they already have saved poses
4. **Draft Outfits**: Creates temporary outfits for non-owners to enable try-on
5. **Return Navigation**: Stores origin path to return user after try-on

### Architecture Highlights
1. **Separation of Concerns**: Services → Hooks → Components
2. **Query Key Factories**: Centralized cache management
3. **Parallel Processing**: Summaries and prefetching run concurrently
4. **Error Boundaries**: Each phase handles failures gracefully
5. **Optimistic Updates**: UI responds immediately, syncs in background

### Extensibility Points
1. **New Garment Types**: Add to slot types and summary generation
2. **Multiple Poses**: Support multiple active poses per user
3. **Background Customization**: Include background_id in generation
4. **Batch Try-Ons**: Generate multiple outfits at once
5. **Social Sharing**: Enhanced metadata for social previews
