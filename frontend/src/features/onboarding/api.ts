import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Error as ApiError, JoinRequest, JoinedMembership } from '@/api/generated.schemas'
import {
  getApiV1MeJoinRequests,
  getGetApiV1MeJoinRequestsQueryKey,
  getGetApiV1MeSpacesQueryKey,
} from '@/api/me/me'
import { postApiV1JoinInvitationsRedeem, postApiV1JoinRequests } from '@/api/tenants/tenants'
import type { ErrorType } from '@/lib/api-client'
import { readAllPages } from '@/lib/pagination'

/** Pending and decided applications for the signed-in user. */
export function useMyJoinRequests() {
  return useQuery({
    queryKey: getGetApiV1MeJoinRequestsQueryKey(),
    queryFn: ({ signal }) =>
      readAllPages((after) =>
        getApiV1MeJoinRequests(after ? { limit: 100, after } : { limit: 100 }, undefined, signal),
      ),
  })
}

/** Redeems one invitation and refreshes the global space list. */
export function useRedeemInvitation() {
  const queryClient = useQueryClient()
  return useMutation<JoinedMembership, ErrorType<ApiError>, string>({
    mutationFn: (token) => postApiV1JoinInvitationsRedeem({ token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetApiV1MeSpacesQueryKey() })
    },
  })
}

/** Submits a request for admin approval without granting access immediately. */
export function useRequestJoin() {
  const queryClient = useQueryClient()
  return useMutation<JoinRequest, ErrorType<ApiError>, string>({
    mutationFn: (token) => postApiV1JoinRequests({ token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetApiV1MeJoinRequestsQueryKey() })
    },
  })
}
