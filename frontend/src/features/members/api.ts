import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { readAllPages } from '@/lib/pagination'
import type { DirectoryPerson, MemberListItem } from '@/api/generated.schemas'
import {
  getApiV1TenantsTidMembers,
  postApiV1TenantsTidMembersHuawei,
  putApiV1TenantsTidMembersUid,
} from '@/api/members/members'
import {
  deleteApiV1TenantsTidInvitationsIid,
  deleteApiV1TenantsTidJoinLinksLid,
  getApiV1TenantsTidInvitations,
  getApiV1TenantsTidJoinLinks,
  getApiV1TenantsTidJoinRequests,
  getApiV1TenantsTidPeople,
  postApiV1TenantsTidInvitations,
  postApiV1TenantsTidJoinLinks,
  postApiV1TenantsTidJoinRequestsRidApprove,
  postApiV1TenantsTidJoinRequestsRidReject,
} from '@/api/tenants/tenants'

/** A single authoritative tenant membership, with its current display name. */
export type TenantMember = MemberListItem

const memberKey = (tenantId: string) => [`/api/v1/tenants/${tenantId}/members`]
const invitationKey = (tenantId: string) => [`/api/v1/tenants/${tenantId}/invitations`]
const linkKey = (tenantId: string) => [`/api/v1/tenants/${tenantId}/join-links`]
const requestKey = (tenantId: string) => [`/api/v1/tenants/${tenantId}/join-requests`]

/** Loads the tenant's member roster once the selected space is known. */
export function useMembers(tenantId: string | undefined) {
  return useQuery({
    queryKey: tenantId ? memberKey(tenantId) : ['members', 'disabled'],
    queryFn: ({ signal }) =>
      readAllPages((after) =>
        getApiV1TenantsTidMembers(
          tenantId ?? '',
          after ? { limit: 100, after } : { limit: 100 },
          undefined,
          signal,
        ),
      ),
    enabled: !!tenantId,
  })
}

/** Changes a tenant role or active status with optimistic version checking. */
export function useUpdateMember(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      userId: string
      role: 'admin' | 'member'
      status: 'active' | 'disabled'
      version: number
    }) =>
      putApiV1TenantsTidMembersUid(tenantId, input.userId, {
        role: input.role,
        status: input.status,
        version: input.version,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKey(tenantId) })
    },
  })
}

/** Searches employed Huawei staff through Ora's bounded server-side adapter. */
export function usePeopleSearch(tenantId: string, keyword: string) {
  return useQuery({
    queryKey: [`/api/v1/tenants/${tenantId}/people`, keyword],
    queryFn: ({ signal }) => getApiV1TenantsTidPeople(tenantId, { keyword }, undefined, signal),
    enabled: tenantId !== '' && keyword.trim().length >= 2,
  })
}

/** Rechecks a selected employee at Tianzhou before granting membership. */
export function useAddHuaweiMember(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { person: DirectoryPerson; keyword: string; role: 'admin' | 'member' }) =>
      postApiV1TenantsTidMembersHuawei(tenantId, {
        keyword: input.keyword,
        globalUserId: input.person.globalUserId,
        role: input.role,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memberKey(tenantId) })
    },
  })
}

/** Generates a browser-only 256-bit token; Cloud persists only its digest. */
export function newJoinToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/** Creates a one-use seven-day ordinary-member invitation. */
export function useCreateInvitation(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => postApiV1TenantsTidInvitations(tenantId, { token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitationKey(tenantId) })
    },
  })
}

/** Creates a reusable thirty-day administrator-approved application link. */
export function useCreateJoinLink(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => postApiV1TenantsTidJoinLinks(tenantId, { token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linkKey(tenantId) })
    },
  })
}

/** Existing invitations are metadata only; raw tokens are never fetched. */
export function useInvitations(tenantId: string) {
  return useQuery({
    queryKey: invitationKey(tenantId),
    queryFn: ({ signal }) =>
      readAllPages((after) =>
        getApiV1TenantsTidInvitations(
          tenantId,
          after ? { limit: 100, after } : { limit: 100 },
          undefined,
          signal,
        ),
      ),
    enabled: tenantId !== '',
  })
}

/** Existing application links are metadata only; raw tokens are never fetched. */
export function useJoinLinks(tenantId: string) {
  return useQuery({
    queryKey: linkKey(tenantId),
    queryFn: ({ signal }) =>
      readAllPages((after) =>
        getApiV1TenantsTidJoinLinks(
          tenantId,
          after ? { limit: 100, after } : { limit: 100 },
          undefined,
          signal,
        ),
      ),
    enabled: tenantId !== '',
  })
}

/** Lists applications an administrator can approve or reject. */
export function useJoinRequests(tenantId: string) {
  return useQuery({
    queryKey: requestKey(tenantId),
    queryFn: ({ signal }) =>
      readAllPages((after) =>
        getApiV1TenantsTidJoinRequests(
          tenantId,
          after ? { limit: 100, after } : { limit: 100 },
          undefined,
          signal,
        ),
      ),
    enabled: tenantId !== '',
  })
}

/** Revokes an invitation with its current version. */
export function useRevokeInvitation(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      deleteApiV1TenantsTidInvitationsIid(tenantId, input.id, { version: input.version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitationKey(tenantId) })
    },
  })
}

/** Revokes an application link with its current version. */
export function useRevokeJoinLink(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      deleteApiV1TenantsTidJoinLinksLid(tenantId, input.id, { version: input.version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linkKey(tenantId) })
    },
  })
}

/** Decides a pending application and refreshes the roster on approval. */
export function useDecideJoinRequest(tenantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; version: number; decision: 'approve' | 'reject' }) =>
      input.decision === 'approve'
        ? postApiV1TenantsTidJoinRequestsRidApprove(tenantId, input.id, { version: input.version })
        : postApiV1TenantsTidJoinRequestsRidReject(tenantId, input.id, { version: input.version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestKey(tenantId) })
      void queryClient.invalidateQueries({ queryKey: memberKey(tenantId) })
    },
  })
}
