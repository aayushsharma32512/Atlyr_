import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

export type StudioTourStepId = 'welcome' | 'mannequin' | 'alternatives' | 'full-screen' | 'product-details' | 'remix' | 'product-interaction' | 'return-from-product' | 'undo-redo' | 'checkpoint' | 'click-details' | 'back-from-details' | 'save-button' | 'share-button' | 'tryon-button'

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

const STUDIO_TOUR_STEPS: StudioTourStep[] = [
    {
        id: 'welcome',
        title: 'Welcome to your Studio!',
        message: 'Your personal styling space awaits. Let\'s show you around.',
        tooltipPosition: { top: '40%', left: 'calc(50% - 144px)' },
    },
    {
        id: 'mannequin',
        title: 'Try Different Styles',
        message: 'Tap any item on the mannequin to explore alternatives and switch things up.',
        tooltipPosition: { top: '40%', right: '20px' },
    },
    {
        id: 'alternatives',
        title: 'Browse & Swap',
        message: 'Scroll through similar items and tap to instantly try them on your look.',
        tooltipPosition: { top: '20%', left: '20px' },
    },
    {
        id: 'full-screen',
        title: 'Go Full Screen',
        message: 'Tap here to open the complete studio experience with all the styling tools.',
        tooltipPosition: { bottom: '300px', right: '40px' },
    },
    {
        id: 'product-details',
        title: 'Your Current Look',
        message: 'Here\'s what you\'re wearing. Tap any item to view details, save, or buy.',
        tooltipPosition: { bottom: '300px', left: 'calc(50% - 144px)' },
    },
    {
        id: 'return-from-product',
        title: 'Easy Navigation',
        message: 'Finished exploring? Tap the back button at the top to return to your studio.',
        tooltipPosition: { top: '80px', left: '20px' },
    },
    {
        id: 'undo-redo',
        title: 'Perfect Your Look',
        message: 'Not sure about a change? Use undo and redo to quickly compare different options.',
        tooltipPosition: { bottom: '400px', right: '80px' },
    },
    {
        id: 'checkpoint',
        title: 'Your Original Style',
        message: 'Want to start over? Tap here to instantly go back to the outfit you started with.',
        tooltipPosition: { bottom: '340px', right: '80px' },
    },
    {
        id: 'remix',
        title: 'Remix Your Look',
        message: 'Feeling adventurous? Tap the remix button to get a fresh perspective on your style.',
        tooltipPosition: { bottom: '240px', left: '80px' },
    },
    {
        id: 'click-details',
        title: 'View Product Details',
        message: 'Tap the Details button to explore product info, similar items, and purchase options.',
        tooltipPosition: { bottom: '300px', left: 'calc(50% - 144px)' },
    },
    {
        id: 'back-from-details',
        title: 'Return to Studio',
        message: 'Tap the back button to return to your studio anytime.',
        tooltipPosition: { top: '80px', left: '20px' },
    },
    {
        id: 'save-button',
        title: 'Save Your Outfit',
        message: 'Love this combo? Tap Save to keep it in your wardrobe or add to a moodboard.',
        tooltipPosition: { bottom: '550px', right: '40px' },
    },
    {
        id: 'share-button',
        title: 'Share Your Style',
        message: 'Want a second opinion? Tap Share to show your look to friends.',
        tooltipPosition: { bottom: '550px', left: '80px' },
    },
    {
        id: 'tryon-button',
        title: 'Virtual Try-On',
        message: 'Curious how it looks? Tap Tryon to see the outfit on a model.',
        tooltipPosition: { bottom: '550px', right: '40px' },
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

        if (currentStepId === 'product-details' && isProductRoute) {
            const returnStepIndex = STUDIO_TOUR_STEPS.findIndex(s => s.id === 'return-from-product')
            if (returnStepIndex !== -1) setCurrentStepIndex(returnStepIndex)
        } else if (currentStepId === 'return-from-product' && isStudioOrAlternatives) {
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
                const currentStepId = STUDIO_TOUR_STEPS[prev].id
                // If user clicks next on "Your Current Look", skip to history tools
                if (currentStepId === 'product-details') {
                    const undoRedoIndex = STUDIO_TOUR_STEPS.findIndex(s => s.id === 'undo-redo')
                    return undoRedoIndex !== -1 ? undoRedoIndex : prev + 1
                }
                return prev + 1
            }
            endTour()
            return 0
        })
    }, [endTour])

    const prevStep = useCallback(() => {
        manualStepChangeRef.current = true
        setCurrentStepIndex(prev => {
            const currentStepId = STUDIO_TOUR_STEPS[prev].id
            // If going back from history tools, skip the interaction steps and go to Step 5
            if (currentStepId === 'undo-redo') {
                const step5Index = STUDIO_TOUR_STEPS.findIndex(s => s.id === 'product-details')
                return step5Index !== -1 ? step5Index : Math.max(0, prev - 1)
            }
            return Math.max(0, prev - 1)
        })
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
