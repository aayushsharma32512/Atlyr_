import { useState, useCallback } from 'react'

export type TourStepId = 'intro' | 'gender' | 'mannequin' | 'category-tabs' | 'product-grid' | 'close-split' | 'history' | 'share'

export interface TourStep {
    id: TourStepId
    title: string
    message: string
    tooltipPosition?: {
        top?: string
        bottom?: string
        left?: string
        right?: string
    }
    requiresSplitView?: boolean
}

const TOUR_STEPS: TourStep[] = [
    {
        id: 'intro',
        title: 'Welcome!',
        message: "to Atlyr's interactive studio demo. Play around to design your perfect outfit",
        tooltipPosition: { top: '30%', left: '20px' },
        requiresSplitView: false
    },
    {
        id: 'gender',
        title: 'Choose Style',
        message: 'Toggle between male and female collections',
        tooltipPosition: { bottom: '80px', left: '20px' },
        requiresSplitView: false
    },
    {
        id: 'mannequin',
        title: 'Tap to Explore',
        message: 'Tap any outfit piece to view alternatives',
        tooltipPosition: { top: '30%', right: '20px' },
        requiresSplitView: false
    },
    {
        id: 'category-tabs',
        title: 'Browse Categories',
        message: 'Switch between Top, Bottom, and Shoes',
        tooltipPosition: { top: '70px', left: '20px' },
        requiresSplitView: true
    },
    {
        id: 'product-grid',
        title: 'Select Items',
        message: 'Tap an item to try it on instantly',
        tooltipPosition: { bottom: '20px', left: '20px' },
        requiresSplitView: true
    },
    {
        id: 'close-split',
        title: 'Back to Studio',
        message: 'Tap X to return to the full outfit view',
        tooltipPosition: { top: '60px', right: '60px' },
        requiresSplitView: true
    },
    {
        id: 'history',
        title: 'Undo / Redo',
        message: 'Changed your mind? Easily undo your changes.',
        tooltipPosition: { top: '50%', left: '70px' }, // Pointing to left controls
        requiresSplitView: false
    },
    {
        id: 'share',
        title: 'Share Your Look',
        message: 'Happy with your design? Share it with friends!',
        tooltipPosition: { top: '80px', right: '60px' },
        requiresSplitView: false // Undo/Redo/Share are in studio mode too
    }
]

export function useMiniStudioTour() {
    const [isActive, setIsActive] = useState(false)
    const [currentStepIndex, setCurrentStepIndex] = useState(0)
    const [hasSeenTour, setHasSeenTour] = useState(() => {
        if (typeof window !== 'undefined') {
            return !!localStorage.getItem('mini-studio-tour-seen')
        }
        return false
    })

    const markAsSeen = useCallback(() => {
        setHasSeenTour(true)
        if (typeof window !== 'undefined') {
            localStorage.setItem('mini-studio-tour-seen', 'true')
        }
    }, [])

    const startTour = useCallback(() => {
        setIsActive(true)
        setCurrentStepIndex(0)
    }, [])

    const endTour = useCallback(() => {
        setIsActive(false)
        setCurrentStepIndex(0)
        markAsSeen()
    }, [markAsSeen])

    const nextStep = useCallback(() => {
        setCurrentStepIndex(prev => {
            if (prev < TOUR_STEPS.length - 1) {
                return prev + 1
            }
            endTour()
            return 0
        })
    }, [endTour])

    const skipTour = useCallback(() => {
        endTour()
    }, [endTour])

    const isHighlighted = useCallback((id: TourStepId) => {
        if (!isActive) return false
        return TOUR_STEPS[currentStepIndex].id === id
    }, [isActive, currentStepIndex])

    const getCurrentStep = useCallback(() => {
        return TOUR_STEPS[currentStepIndex] || null
    }, [currentStepIndex])

    return {
        isActive,
        currentStepIndex,
        hasSeenTour,
        startTour,
        endTour,
        nextStep,
        skipTour,
        setHasSeenTour,
        isHighlighted,
        getCurrentStep,
        steps: TOUR_STEPS
    }
}
