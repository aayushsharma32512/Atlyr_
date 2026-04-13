export const ENGAGEMENT_EVENT_NAMES = [
  "screen_entered",
  "screen_duration",
  "items_seen_summary",
  "waitlist_submitted",
  "invite_code_validated",
  "invite_redeemed",
  "auth_signup_succeeded",
  "auth_login_succeeded",
  "search_submitted",
  "moodboard_selected",
  "item_clicked",
  "save_toggled",
  "saved_to_collection",
  "product_buy_clicked",
  "studio_combination_viewed",
  "studio_product_viewed",
  "tryon_flow_started",
  "tryon_generation_started",
  "tryon_generation_completed",
  "tryon_result_viewed",
] as const

export type EngagementEventName = (typeof ENGAGEMENT_EVENT_NAMES)[number]

export const ENGAGEMENT_SURFACES = [
  // Landing + auth
  "landing",
  "auth_login",
  "auth_signup",
  "auth_callback",

  // Main tabs
  "home_feed",
  "home_moodboard",
  "search_results",
  "collections_moodboards",
  "collections_creations",
  "collections_products",
  "profile",

  // Studio session surfaces
  "studio_main",
  "studio_alternatives",
  "studio_scroll_up",
  "studio_likeness",

  // Studio non-session surfaces
  "studio_product_page",
  "studio_similar",
  "studio_outfit_suggestions",
] as const

export type Surface = (typeof ENGAGEMENT_SURFACES)[number]

export type ScreenEnteredEvent = {
  event: "screen_entered"
  properties: {
    session_id: string
    surface: Surface
    entry_surface: Surface | "unknown"
    moodboard_slug?: string
    has_invite_param?: boolean
    is_returning_device?: boolean
    landing_path?: string
    referrer?: string
  } & Record<string, unknown>
}

export type ScreenDurationEvent = {
  event: "screen_duration"
  properties: {
    session_id: string
    surface: Surface
    active_duration_ms: number
  }
}

export type EngagementEvent = ScreenEnteredEvent | ScreenDurationEvent
