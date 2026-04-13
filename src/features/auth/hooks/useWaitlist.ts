import { useMutation } from "@tanstack/react-query"

import { waitlistService } from "@/services/auth/waitlistService"

export function useWaitlistSubmissionMutation() {
  return useMutation({
    mutationFn: waitlistService.submitToWaitlist,
  })
}

