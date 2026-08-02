import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Two ids were dropped when the studio moved to the 7a layout:
 *  · 'product-interaction' was consumed by StudioScreen but never existed in
 *    STUDIO_TOUR_STEPS, so that branch could never be true.
 *  · 'full-screen' existed as a step but nothing consumed it, so it rendered a
 *    tooltip pointing at nothing.
 */
export type StudioTourStepId =
    | 'welcome'
    | 'mannequin'
    | 'slot-rows'
    | 'alternatives'
    | 'remix'
    | 'return-from-product'
    | 'undo-redo'
    | 'checkpoint'
    | 'click-details'
    | 'back-from-details'
    | 'save-button'
    | 'share-button'
    | 'tryon-button'

export interface StudioTourStep {
    id: StudioTourStepId
    title: string
    message: string
    tooltipPosition?: {
        top?: string
        bottom?: string
        left?: string
        right?: string
        transform?: string
    }
}

/**
 * Positions are viewport-fixed (the tooltip is `position: fixed`), so they are
 * written against the CENTRE rather than as raw pixel offsets from an edge.
 *
 * The studio is a 384px-wide frame, capped at 844px tall and centred both ways,
 * so `calc(50% ± n)` tracks it on any screen while the old `bottom: 550px`
 * style offsets pointed at empty space the moment the window wasn't phone-sized.
 * The tooltip is w-72 (288px), hence the recurring 144px half-width.
 */
const FRAME_HALF_WIDTH = 192 // max-w-sm / 2
const TOOLTIP_HALF_WIDTH = 144 // w-72 / 2

/** Beside the frame, clear of its left/right edge — for the canvas-edge clusters. */
const BESIDE_LEFT = `calc(50% + ${FRAME_HALF_WIDTH - 8}px)`
const BESIDE_RIGHT = `calc(50% + ${FRAME_HALF_WIDTH - 8}px)`
/** Horizontally centred on the frame. */
const CENTRED = `calc(50% - ${TOOLTIP_HALF_WIDTH}px)`

const STUDIO_TOUR_STEPS: StudioTourStep[] = [
    {
        id: 'welcome',
        title: 'Welcome to your Studio!',
        message: 'Your personal styling space awaits. Let\'s show you around.',
        tooltipPosition: { top: '42%', left: CENTRED },
    },
    {
        id: 'mannequin',
        title: 'Tap what you\'re wearing',
        message: 'Tap any garment on the model to open the full rack of alternatives for that slot.',
        tooltipPosition: { top: '30%', left: CENTRED },
    },
    {
        id: 'undo-redo',
        title: 'Perfect your look',
        message: 'Changed your mind? Undo and redo sit on the left edge of the model.',
        tooltipPosition: { top: '18%', left: BESIDE_LEFT },
    },
    {
        id: 'checkpoint',
        title: 'Your original style',
        message: 'Tap ⟲ to jump back to the look you started with — tap it again to return to your edits.',
        tooltipPosition: { top: '27%', left: BESIDE_LEFT },
    },
    {
        id: 'remix',
        title: 'Shuffle the look',
        message: 'Feeling adventurous? Shuffle rebuilds the outfit from scratch.',
        tooltipPosition: { top: '18%', right: BESIDE_RIGHT },
    },
    {
        id: 'share-button',
        title: 'Share your style',
        message: 'Want a second opinion? Share sends the look to a friend, view-only.',
        tooltipPosition: { top: '27%', right: BESIDE_RIGHT },
    },
    {
        id: 'slot-rows',
        title: 'The pieces you\'re wearing',
        message: 'Tap a row for that piece\'s details, ⟳ to swap it for something else, or ✕ to take it off.',
        tooltipPosition: { bottom: '24%', left: CENTRED },
    },
    {
        id: 'save-button',
        title: 'Save your outfit',
        message: 'Love this combo? Save keeps it in your boards.',
        tooltipPosition: { bottom: '14%', left: CENTRED },
    },
    {
        id: 'tryon-button',
        title: 'Virtual try-on',
        message: 'Curious how it looks on you? Try on puts the outfit on your likeness.',
        tooltipPosition: { bottom: '14%', left: CENTRED },
    },
    {
        id: 'click-details',
        title: 'Shop the look',
        message: 'The priced stub opens the receipt — every piece, with somewhere to buy it.',
        tooltipPosition: { bottom: '14%', left: CENTRED },
    },
    {
        id: 'alternatives',
        title: 'Browse & swap',
        message: 'Scroll through similar items and tap to instantly try them on your look.',
        tooltipPosition: { top: '20%', left: '20px' },
    },
    {
        id: 'return-from-product',
        title: 'Easy navigation',
        message: 'Finished exploring? Tap the back button at the top to return to your studio.',
        tooltipPosition: { top: '80px', left: '20px' },
    },
    {
        id: 'back-from-details',
        title: 'Return to Studio',
        message: 'Tap the back button to return to your studio anytime.',
        tooltipPosition: { top: '80px', left: '20px' },
    },
]

export function useStudioTour() {
    const [isActive, setIsActive] = useState(false)
    const [currentStepIndex, setCurrentStepIndex] = useState(0)
    const manualStepChangeRef = useRef(false)
    const [hasSeenTour, setHasSeenTour] = useState(() => {
        if (typeof window !== 'undefined') {
            return !!localStorage.getItem('studio-tour-seen')
        }
        return false
    })

    const location = useLocation()

    // Reset if closing
    const endTour = useCallback(() => {
        manualStepChangeRef.current = false
        setIsActive(false)
        setCurrentStepIndex(0)
        setHasSeenTour(true)
        if (typeof window !== 'undefined') {
            localStorage.setItem('studio-tour-seen', 'true')
        }
    }, [])

    const startTour = useCallback(() => {
        if (hasSeenTour) return // Optional: force start?
        setIsActive(true)
        setCurrentStepIndex(0)
    }, [hasSeenTour])

    // Force start (e.g. from help button)
    const restartTour = useCallback(() => {
        setIsActive(true)
        setCurrentStepIndex(0)
    }, [])

    // Auto-advance logic for product interaction
    useEffect(() => {
        if (!isActive) return

        // Skip auto-advance if the step was just changed manually
        if (manualStepChangeRef.current) {
            manualStepChangeRef.current = false
            return
        }

        const currentStepId = STUDIO_TOUR_STEPS[currentStepIndex].id
        const isProductRoute = location.pathname.includes('/product/')
        const isScrollUpRoute = location.pathname.includes('/scroll-up')
        const isStudioOrAlternatives = (location.pathname.includes('/studio') || location.pathname.includes('/alternatives')) && !isProductRoute && !isScrollUpRoute

        if (currentStepId === 'return-from-product' && isStudioOrAlternatives) {
            const undoRedoIndex = STUDIO_TOUR_STEPS.findIndex(s => s.id === 'undo-redo')
            if (undoRedoIndex !== -1) setCurrentStepIndex(undoRedoIndex)
        } else if (currentStepId === 'click-details' && isScrollUpRoute) {
            // When on click-details and user navigates to scroll-up, advance to back-from-details
            const backFromDetailsIndex = STUDIO_TOUR_STEPS.findIndex(s => s.id === 'back-from-details')
            if (backFromDetailsIndex !== -1) setCurrentStepIndex(backFromDetailsIndex)
        } else if (currentStepId === 'back-from-details' && isStudioOrAlternatives) {
            // When on back-from-details and user navigates back to studio, advance to save-button
            const saveButtonIndex = STUDIO_TOUR_STEPS.findIndex(s => s.id === 'save-button')
            if (saveButtonIndex !== -1) setCurrentStepIndex(saveButtonIndex)
        } else if (currentStepId === 'save-button' && isScrollUpRoute) {
            // When on save-button and user navigates back to scroll-up (back button), go to back-from-details
            const backFromDetailsIndex = STUDIO_TOUR_STEPS.findIndex(s => s.id === 'back-from-details')
            if (backFromDetailsIndex !== -1) setCurrentStepIndex(backFromDetailsIndex)
        }
    }, [isActive, location.pathname, currentStepIndex, endTour])

    const nextStep = useCallback(() => {
        manualStepChangeRef.current = true
        setCurrentStepIndex(prev => {
            if (prev < STUDIO_TOUR_STEPS.length - 1) {
                return prev + 1
            }
            endTour()
            return 0
        })
    }, [endTour])

    const prevStep = useCallback(() => {
        manualStepChangeRef.current = true
        setCurrentStepIndex(prev => Math.max(0, prev - 1))
    }, [])

    const goToStep = useCallback((stepId: StudioTourStepId) => {
        manualStepChangeRef.current = true
        const index = STUDIO_TOUR_STEPS.findIndex(s => s.id === stepId)
        if (index !== -1) {
            setCurrentStepIndex(index)
        }
    }, [])

    const skipTour = useCallback(() => {
        endTour()
    }, [endTour])

    const getCurrentStep = useCallback(() => {
        return STUDIO_TOUR_STEPS[currentStepIndex] || null
    }, [currentStepIndex])

    const isHighlighted = useCallback((id: StudioTourStepId) => {
        if (!isActive) return false
        return STUDIO_TOUR_STEPS[currentStepIndex].id === id
    }, [isActive, currentStepIndex])

    return {
        isActive,
        currentStepIndex,
        hasSeenTour,
        startTour,
        restartTour,
        endTour,
        nextStep,
        prevStep,
        goToStep,
        skipTour,
        getCurrentStep,
        isHighlighted,
        steps: STUDIO_TOUR_STEPS
    }
}
