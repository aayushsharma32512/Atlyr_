import { createContext, useContext, useMemo, type ReactNode } from "react"

import type { ProfileRecord } from "@/services/profile/profileService"
import { useProfileQuery } from "@/features/profile/hooks/useProfileQuery"
import { useOptionalAdminGender } from "@/features/admin/providers/AdminGenderContext"

type Gender = "male" | "female" | null
type UserRole = "user" | "admin"

interface ProfileContextValue {
  profile: ProfileRecord | null
  gender: Gender
  heightCm: number | null
  skinTone: string | null
  hairStyleId: string | null
  hairColorHex: string | null
  role: UserRole
  isLoading: boolean
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { data: profile, isLoading: isProfileLoading } = useProfileQuery()

  // Admin-selected gender overrides profile gender
  const adminGender = useOptionalAdminGender()
  const profileGender: Gender =
    profile?.gender === "male" || profile?.gender === "female" ? (profile.gender as Gender) : null
  const gender: Gender = adminGender ?? profileGender

  const heightCm =
    typeof (profile as Record<string, unknown> | null)?.["height_cm"] === "number"
      ? ((profile as Record<string, unknown>)["height_cm"] as number)
      : null

  const skinTone = profile?.selected_skin_tone ?? null
  const hairStyleId = profile?.hair_style_id ?? null
  const hairColorHex = profile?.hair_color_hex ?? null

  const role: UserRole =
    profile?.role === "admin" ? "admin" : "user"

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile: profile ?? null,
      gender,
      heightCm,
      skinTone,
      hairStyleId,
      hairColorHex,
      role,
      isLoading: isProfileLoading,
    }),
    [gender, hairColorHex, hairStyleId, heightCm, isProfileLoading, profile, role, skinTone],
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfileContext() {
  const context = useContext(ProfileContext)
  if (!context) {
    throw new Error("useProfileContext must be used within a ProfileProvider")
  }
  return context
}
