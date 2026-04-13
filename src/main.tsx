import React from 'react'
import { createRoot } from 'react-dom/client'
import { PostHogProvider } from 'posthog-js/react'
import App from './App.tsx'
import './index.css'
import { shouldDisablePostHogForLocation } from './integrations/posthog/posthogRoutePolicy'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PostHogProvider
      apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY}
      options={{
        api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
        defaults: '2025-05-24',
        capture_exceptions: true,
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: '*',
        },
        before_send: (event) => {
          const hostname = window.location.hostname

          const rawUrl =
            (event as { properties?: Record<string, unknown> } | null)?.properties?.[
              '$current_url'
            ] ?? window.location.href

          const url = typeof rawUrl === 'string' ? rawUrl : window.location.href

          let pathname = window.location.pathname
          try {
            pathname = new URL(url).pathname
          } catch {
            // ignore
          }

          const shouldDisable = shouldDisablePostHogForLocation({ hostname, pathname })
          if (shouldDisable) return null
          return event
        },
        debug: import.meta.env.MODE === 'development',
      }}
    >
      <App />
    </PostHogProvider>
  </React.StrictMode>
)
