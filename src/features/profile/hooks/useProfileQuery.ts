import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { profileKeys } from "@/features/profile/queryKeys"
import { profileService, type ProfileRecord, type ProfileUpdateInput } from "@/services/profile/profileService"

export function useProfileQuery() {
  const { user } = useAuth()

  return useQuery({
    queryKey: profileKeys.detail(user?.id ?? null),
    queryFn: () => (user?.id ? profileService.getProfile(user.id) : null),
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000,
  })
}

export function useProfileUpdateMutation() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationKey: profileKeys.update(user?.id ?? null),
    mutationFn: (updates: ProfileUpdateInput) => {
      if (!user?.id) {
        throw new Error("Cannot update profile without an authenticated user")
      }
      return profileService.updateProfile(user.id, updates)
    },
    onSuccess: (data) => {
      queryClient.setQueryData<ProfileRecord | null>(profileKeys.detail(user?.id ?? null), data)
    },
  })
}

/** Auth emits USER_UPDATED after the upload, so the new photo reaches `useAuth().user` on its own. */
export function useProfilePhotoMutation() {
  const { user } = useAuth()

  return useMutation({
    mutationKey: profileKeys.photo(user?.id ?? null),
    mutationFn: (file: File) => {
      if (!user?.id) {
        throw new Error("Cannot upload a photo without an authenticated user")
      }
      return profileService.uploadProfilePhoto(user.id, file)
    },
  })
}
