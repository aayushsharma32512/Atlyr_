export const authKeys = {
  all: ["auth"] as const,
  access: (userId: string | null) => [...authKeys.all, "access", userId] as const,
  inviteValidation: (code: string | null) => [...authKeys.all, "inviteValidation", code] as const,
}
