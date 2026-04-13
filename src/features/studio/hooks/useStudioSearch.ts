import { useCallback, useRef, useMemo, useState } from "react"
import type { StudioProductTraySlot } from "@/services/studio/studioService"
import type { ProductSearchFilters } from "@/services/search/searchService"
import { uploadSearchImage } from "@/services/storage/publicFilesService"
import {
    useStudioContext,
    INITIAL_SLOT_SEARCH_STATE,
    type SlotSearchState
} from "@/features/studio/context/StudioContext"

export interface UseStudioSearchReturn {
    // Draft state (what user is typing/uploading - grid doesn't update)
    draftText: string
    setDraftText: (text: string) => void
    draftImageUrl: string | null
    isUploadingImage: boolean

    // Committed state (what's actively searching - grid shows this)
    committedText: string
    committedImageUrl: string | null

    // Filters
    activeFilters: ProductSearchFilters
    setActiveFilters: (filters: ProductSearchFilters) => void
    activeFilterIds: string[]
    setActiveFilterIds: (ids: string[]) => void

    // Actions
    handleSubmit: () => void
    handleImageUpload: (file: File) => Promise<void>
    handleClearImage: () => void
    handleClearDraftText: () => void
    handleClearAll: () => void
    handleForceSearch: (imageUrl: string) => void
    resetForSlot: (slot: StudioProductTraySlot, autoSearchImageUrl: string | null, asDraft?: boolean) => void

    // Helpers
    hasActiveSearch: boolean
    isSearching: boolean
    seedDraftImage: (url: string | null) => void
}

interface UseStudioSearchOptions {
    onUploadError?: (error: Error) => void
}

export function useStudioSearch(options: UseStudioSearchOptions = {}): UseStudioSearchReturn {
    const { onUploadError } = options

    // Get search state from context - persists across route changes
    const {
        slotSearchStates,
        setSlotSearchStates,
        activeSearchSlot,
        setActiveSearchSlot
    } = useStudioContext()

    // Track if we're uploading an image (local reactive state)
    const [isUploadingImage, setIsUploadingImage] = useState(false)

    // Track if we're in the middle of a search operation
    const isSearchingRef = useRef(false)

    // Helper to get current state safely
    const currentState = useMemo(() => {
        if (!activeSearchSlot || !slotSearchStates[activeSearchSlot]) return INITIAL_SLOT_SEARCH_STATE
        return slotSearchStates[activeSearchSlot]
    }, [activeSearchSlot, slotSearchStates])

    // Helper to update current slot state
    const updateCurrentSlotState = useCallback((updates: Partial<SlotSearchState>) => {
        if (!activeSearchSlot) return
        setSlotSearchStates((prev) => ({
            ...prev,
            [activeSearchSlot]: {
                ...(prev[activeSearchSlot] || INITIAL_SLOT_SEARCH_STATE),
                ...updates,
            },
        }))
    }, [activeSearchSlot, setSlotSearchStates])

    // --- GETTERS ---
    const {
        draftText,
        draftImageUrl,
        committedText,
        committedImageUrl,
        activeFilters,
        activeFilterIds,
    } = currentState

    // --- SETTERS ---
    const setDraftText = useCallback((text: string) => updateCurrentSlotState({ draftText: text }), [updateCurrentSlotState])

    const setDraftImageUrlInternal = useCallback((url: string | null) => updateCurrentSlotState({ draftImageUrl: url }), [updateCurrentSlotState])

    const setActiveFilters = useCallback((filters: ProductSearchFilters) => updateCurrentSlotState({ activeFilters: filters }), [updateCurrentSlotState])

    const setActiveFilterIds = useCallback((ids: string[]) => updateCurrentSlotState({ activeFilterIds: ids }), [updateCurrentSlotState])

    // --- ACTIONS ---

    const handleSubmit = useCallback(() => {
        const trimmedText = draftText.trim()

        console.log('[StudioSearch] Submit called with:', {
            draftText: trimmedText || '(none)',
            draftImageUrl: draftImageUrl || '(none)',
        })

        if (draftImageUrl) {
            console.log('[StudioSearch] Committing image search')
            updateCurrentSlotState({
                committedImageUrl: draftImageUrl,
                committedText: trimmedText,
            })
        } else if (trimmedText) {
            console.log('[StudioSearch] Committing text-only search')
            updateCurrentSlotState({
                committedText: trimmedText,
                committedImageUrl: null,
            })
        }
    }, [draftText, draftImageUrl, updateCurrentSlotState])

    const handleImageUpload = useCallback(
        async (file: File) => {
            try {
                setIsUploadingImage(true)
                const publicUrl = await uploadSearchImage({ file })
                setDraftImageUrlInternal(publicUrl)
            } catch (error) {
                console.error("Image upload failed:", error)
                onUploadError?.(error instanceof Error ? error : new Error("Image upload failed"))
            } finally {
                setIsUploadingImage(false)
            }
        },
        [onUploadError, setDraftImageUrlInternal],
    )

    const handleClearImage = useCallback(() => {
        setDraftImageUrlInternal(null)
    }, [setDraftImageUrlInternal])

    const handleClearDraftText = useCallback(() => {
        setDraftText("")
    }, [setDraftText])

    const handleClearAll = useCallback(() => {
        updateCurrentSlotState({
            draftText: "",
            draftImageUrl: null,
            committedText: "",
            committedImageUrl: null,
            activeFilters: {},
            activeFilterIds: [],
        })
    }, [updateCurrentSlotState])

    const handleForceSearch = useCallback((imageUrl: string) => {
        console.log('[StudioSearch] Force search with image:', imageUrl)
        updateCurrentSlotState({
            draftText: "",
            draftImageUrl: null,
            committedText: "",
            committedImageUrl: imageUrl,
        })
    }, [updateCurrentSlotState])

    const resetForSlot = useCallback((slot: StudioProductTraySlot, autoSearchImageUrl: string | null, asDraft = false) => {
        // Called on tab switch.
        // If we already have state for this slot, RESUME it (persistence).
        // If we don't, INITIALIZE it with auto-search image.

        setActiveSearchSlot(slot)

        setSlotSearchStates((prev) => {
            if (prev[slot]) {
                console.log('[StudioSearch] Restoring state for slot:', slot)
                return prev
            }

            console.log('[StudioSearch] Initializing state for slot:', slot, 'with image:', autoSearchImageUrl || '(none)', 'asDraft:', asDraft)
            return {
                ...prev,
                [slot]: {
                    ...INITIAL_SLOT_SEARCH_STATE,
                    // If asDraft is true, seed as draft (Admin Mode) - no auto search
                    // If asDraft is false, seed as committed (User Mode) - auto search
                    draftImageUrl: asDraft ? autoSearchImageUrl : null,
                    committedImageUrl: asDraft ? null : autoSearchImageUrl,
                }
            }
        })
    }, [setActiveSearchSlot, setSlotSearchStates])

    // Derived state
    const hasActiveSearch = Boolean(committedText || committedImageUrl)
    const isSearching = isSearchingRef.current

    const seedDraftImage = useCallback((url: string | null) => {
        updateCurrentSlotState({
            draftImageUrl: url,
            committedImageUrl: null,
            draftText: "",
            committedText: "",
        })
    }, [updateCurrentSlotState])

    return {
        draftText,
        setDraftText,
        draftImageUrl,
        isUploadingImage,
        committedText,
        committedImageUrl,
        activeFilters,
        setActiveFilters,
        activeFilterIds,
        setActiveFilterIds,
        handleSubmit,
        handleImageUpload,
        handleClearImage,
        handleClearDraftText,
        handleClearAll,
        handleForceSearch,
        resetForSlot,
        seedDraftImage, // New action
        hasActiveSearch,
        isSearching,
    }
}
