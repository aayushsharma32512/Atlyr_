const AUTH_INTENT_KEY = "engagement:auth_intent_v1"

export type AuthIntent = "login" | "signup"

export function setAuthIntent(intent: AuthIntent) {
  try {
    localStorage.setItem(AUTH_INTENT_KEY, intent)
  } catch {
    // ignore
  }
}

export function getAuthIntent(): AuthIntent | null {
  try {
    const raw = localStorage.getItem(AUTH_INTENT_KEY)
    if (raw === "login" || raw === "signup") return raw
    return null
  } catch {
    return null
  }
}

export function clearAuthIntent() {
  try {
    localStorage.removeItem(AUTH_INTENT_KEY)
  } catch {
    // ignore
  }
}

