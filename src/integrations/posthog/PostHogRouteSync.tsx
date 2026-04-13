import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { usePostHog } from "posthog-js/react"

import { shouldDisablePostHogForLocation } from "@/integrations/posthog/posthogRoutePolicy"

type Props = {
  enableSessionReplay: boolean
}

export function PostHogRouteSync({ enableSessionReplay }: Props) {
  const location = useLocation()
  const posthog = usePostHog()

  useEffect(() => {
    if (!posthog) return

    const hostname = window.location.hostname
    const pathname = location.pathname
    const shouldDisable = shouldDisablePostHogForLocation({ hostname, pathname })

    if (shouldDisable) {
      // Hard block: no legacy (/app) + no non-prod domains + no non-allowed routes.
      posthog.stopSessionRecording()
      return
    }

    // Replay is opt-in and only runs on allowed routes.
    if (enableSessionReplay) {
      posthog.startSessionRecording()
    } else {
      posthog.stopSessionRecording()
    }
  }, [enableSessionReplay, location.pathname, location.search, posthog])

  return null
}
