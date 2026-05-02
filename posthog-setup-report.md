<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics across both the Python data-pipeline scripts and the TypeScript/React frontend. Environment variables were written to `.env.local`, `posthog` was added to `requirements.txt`, and event capture calls were added to seven files covering the onboarding funnel, outfit management, checkout flow, and all four embedding pipeline scripts.

## Events added

| Event | Description | File |
|---|---|---|
| `embedding_run_completed` | Fires at the end of a product embedding queue run — reports mode, total processed, successful, failed, text/image counts, and duration. | `scripts/embedding_update.py` |
| `embedding_run_completed` | Same event for outfit embedding queue runs — same properties plus `embedding_type: "outfit"`. | `scripts/outfit_embedding_update.py` |
| `embedding_run_completed` | Fires at the end of a bulk product embedding regeneration run — `mode: "bulk_regenerate"`, total processed, successful, failed, and duration. | `scripts/generate-fashion-siglip.py` |
| `embedding_run_completed` | Same event for bulk outfit embedding regeneration runs — `embedding_type: "outfit"`, `mode: "bulk_regenerate"`. | `scripts/generate-outfit-embeddings.py` |
| `onboarding_step_completed` | Fires each time the user advances past a step (`welcome`, `personal_info`, `avatar_face_shape`, `avatar_skin_tone`, `avatar_hairstyle`). Includes `step` and, where relevant, `gender`. | `src/components/onboarding/OnboardingFlow.tsx` |
| `onboarding_completed` | Fires when the user taps "Get Started" and the profile save succeeds. Includes `gender` and `has_height`. | `src/components/onboarding/OnboardingFlow.tsx` |
| `draft_outfit_saved` | Fires when a user publishes a draft outfit from the Creations tab. Includes `collection_count` and `is_private`. | `src/features/collections/components/CreationsTab.tsx` |
| `outfit_edited` | Fires when a user saves edits to an existing (non-draft) outfit. Includes `collections_added`, `collections_removed`, and `is_private`. | `src/features/collections/components/CreationsTab.tsx` |
| `checkout_viewed` | Fires when the CheckoutScreen mounts with a valid outfit. Includes `item_count`. | `src/components/checkout/CheckoutScreen.tsx` |
| `checkout_proceeded` | Fires when the user taps "Proceed to Payment". Includes `item_count`. | `src/components/checkout/CheckoutScreen.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics:** https://us.posthog.com/project/403151/dashboard/1525931
- **Onboarding funnel** (welcome → personal info → avatar → completed): https://us.posthog.com/project/403151/insights/xQJLtSpL
- **Daily onboarding completions** (trend): https://us.posthog.com/project/403151/insights/amTYJixB
- **Checkout conversion funnel** (viewed → proceeded to payment): https://us.posthog.com/project/403151/insights/hyGKitYf
- **Outfit saves and edits** (draft saves + edits over time): https://us.posthog.com/project/403151/insights/VaOfrV4o
- **Embedding pipeline runs** (product vs outfit runs over time): https://us.posthog.com/project/403151/insights/0POVhKO6

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-python/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
