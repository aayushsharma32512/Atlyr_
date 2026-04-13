import { useEffect, useRef } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { authKeys } from "@/features/auth/queryKeys"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { inviteService } from "@/services/auth/inviteService"

export function useHasAppAccessQuery(enabled = true) {
  const { user } = useAuth()

  return useQuery({
    queryKey: authKeys.access(user?.id ?? null),
    queryFn: () => inviteService.hasAppAccess(),
    enabled: enabled && Boolean(user?.id),
    staleTime: 60 * 1000,
  })
}

export function useInviteValidationQuery(code: string | null) {
  const analytics = useEngagementAnalytics()
  const lastEmittedRef = useRef<string | null>(null)

  const query = useQuery({
    queryKey: authKeys.inviteValidation(code),
    queryFn: () => inviteService.validateInviteCode(code ?? ""),
    enabled: Boolean(code),
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (!code) return

    if (query.isSuccess) {
      const valid = Boolean(query.data?.valid)
      const reason = typeof query.data?.error === "string" ? query.data.error : undefined
      const sig = `success:${valid}:${reason ?? ""}`
      if (lastEmittedRef.current === sig) return
      lastEmittedRef.current = sig

      analytics.capture("invite_code_validated", valid ? { valid: true } : { valid: false, reason })
      return
    }

    if (query.isError) {
      const sig = "error:server_error"
      if (lastEmittedRef.current === sig) return
      lastEmittedRef.current = sig
      analytics.capture("invite_code_validated", { valid: false, reason: "server_error" })
    }
  }, [analytics, code, query.data?.error, query.data?.valid, query.isError, query.isSuccess])

  return query
}

export function useRedeemInviteMutation() {
  const analytics = useEngagementAnalytics()
  return useMutation({
    mutationFn: (code: string) => inviteService.redeemInvite(code),
    onSuccess: (result) => {
      if (result?.success) {
        analytics.capture("invite_redeemed", { success: true })
      }
    },
  })
}

export function useValidateInviteMutation() {
  const analytics = useEngagementAnalytics()
  return useMutation({
    mutationFn: (code: string) => inviteService.validateInviteCode(code),
    onSuccess: (result) => {
      if (result.valid) {
        analytics.capture("invite_code_validated", { valid: true })
        return
      }
      const reason = typeof result.error === "string" ? result.error : undefined
      analytics.capture("invite_code_validated", { valid: false, reason })
    },
    onError: () => {
      analytics.capture("invite_code_validated", { valid: false, reason: "server_error" })
    },
  })
}
