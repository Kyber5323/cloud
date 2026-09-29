import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLoginProviders } from '@/features/auth/providers'
import {
  newJoinToken,
  useAddHuaweiMember,
  useCreateInvitation,
  useCreateJoinLink,
  useDecideJoinRequest,
  useInvitations,
  useJoinLinks,
  useJoinRequests,
  useMembers,
  usePeopleSearch,
  useRevokeInvitation,
  useRevokeJoinLink,
  useUpdateMember,
  type TenantMember,
} from '@/features/members/api'
import { normalizeSpaceRole } from '@/features/spaces/api'
import { useCurrentSpace } from '@/features/spaces/current-space'
import { joinUrl } from '@/lib/paths'
import { faultCode } from '@/lib/api-client'

/** Tenant roster with deployment-specific entry points for new members. */
export function MembersPage({ slug }: { slug: string }) {
  const { tenantId, space } = useCurrentSpace()
  const { data: providers } = useLoginProviders()
  const activeTenant = space?.slug === slug ? tenantId : undefined
  const members = useMembers(activeTenant)
  if (!activeTenant || !space) return null
  const canManage = normalizeSpaceRole(space.role) === 'admin'
  return (
    <div className="space-y-6 p-4">
      <h1 className="text-lg font-semibold">空间成员</h1>
      {canManage &&
        providers &&
        (providers.includes('huawei-idaas') ? (
          <HuaweiAdd tenantId={activeTenant} />
        ) : (
          <ExternalInvites tenantId={activeTenant} />
        ))}
      {members.isError && <p className="text-sm text-destructive">成员列表加载失败</p>}
      {members.isPending && <p className="text-sm text-muted-foreground">正在加载成员…</p>}
      {members.data && (
        <div className="space-y-2">
          {members.data.items.map((member) => (
            <MemberRow
              key={member.userId}
              tenantId={activeTenant}
              member={member}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** One member's current role and status, guarded by the row version. */
function MemberRow({
  tenantId,
  member,
  canManage,
}: {
  tenantId: string
  member: TenantMember
  canManage: boolean
}) {
  const update = useUpdateMember(tenantId)
  const role = normalizeSpaceRole(member.role)
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{member.displayName || member.userId}</p>
        <p className="text-xs text-muted-foreground">
          {member.status === 'active' ? '已加入' : '已停用'}
        </p>
      </div>
      {canManage ? (
        <>
          <Select
            disabled={member.status === 'disabled' || update.isPending}
            value={role}
            onValueChange={(value) =>
              update.mutate({
                userId: member.userId,
                role: normalizeSpaceRole(value ?? 'member'),
                status: member.status === 'disabled' ? 'disabled' : 'active',
                version: member.version,
              })
            }
          >
            <SelectTrigger className="w-28" aria-label={`${member.displayName} 的角色`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">管理员</SelectItem>
              <SelectItem value="member">成员</SelectItem>
            </SelectContent>
          </Select>
          {member.status === 'active' ? (
            <Button
              variant="outline"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  userId: member.userId,
                  role,
                  status: 'disabled',
                  version: member.version,
                })
              }
            >
              移除
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">重新加入需再次核验或邀请</span>
          )}
        </>
      ) : (
        <span className="text-sm">{role === 'admin' ? '管理员' : '成员'}</span>
      )}
      {update.isError && (
        <p className="basis-full text-xs text-destructive">
          操作失败：{faultCode(update.error) ?? 'unknown'}
        </p>
      )}
    </div>
  )
}

/** Searches Tianzhou through Ora and rechecks the selected employee on add. */
function HuaweiAdd({ tenantId }: { tenantId: string }) {
  const [keyword, setKeyword] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const people = usePeopleSearch(tenantId, keyword)
  const add = useAddHuaweiMember(tenantId)
  return (
    <section className="space-y-3 rounded-md border p-4">
      <h2 className="font-medium">从华为人员目录添加</h2>
      <div className="flex gap-2">
        <Input
          aria-label="搜索姓名或工号"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="姓名或工号，至少两个字符"
        />
        <Select
          value={role}
          onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}
        >
          <SelectTrigger className="w-28" aria-label="新成员角色">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">成员</SelectItem>
            <SelectItem value="admin">管理员</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {people.isError && <p className="text-sm text-destructive">人员目录暂不可用，请稍后再试</p>}
      {people.data?.items.map((person) => (
        <div key={person.globalUserId} className="flex items-center gap-2 border-b py-2 text-sm">
          <span className="min-w-0 flex-1">
            {person.name} · {person.employeeNumber} · {person.departmentName}
          </span>
          <Button
            size="sm"
            disabled={add.isPending}
            onClick={() => add.mutate({ person, keyword, role })}
          >
            添加
          </Button>
        </div>
      ))}
      {add.isError && (
        <p className="text-xs text-destructive">添加失败：{faultCode(add.error) ?? 'unknown'}</p>
      )}
    </section>
  )
}

/** Creates private links and handles approvals in public-network deployments. */
function ExternalInvites({ tenantId }: { tenantId: string }) {
  const invitation = useCreateInvitation(tenantId)
  const application = useCreateJoinLink(tenantId)
  const invitations = useInvitations(tenantId)
  const links = useJoinLinks(tenantId)
  const requests = useJoinRequests(tenantId)
  const revokeInvitation = useRevokeInvitation(tenantId)
  const revokeLink = useRevokeJoinLink(tenantId)
  const decide = useDecideJoinRequest(tenantId)
  const [shareUrl, setShareUrl] = useState('')

  return (
    <section className="space-y-4 rounded-md border p-4">
      <h2 className="font-medium">邀请与加入申请</h2>
      <p className="text-sm text-muted-foreground">
        邀请链接 7 天有效且只能兑换一次；申请链接 30
        天有效，可供多人申请。创建后请立即复制链接，服务端不会保存原文。
      </p>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            const token = newJoinToken()
            invitation.mutate(token, { onSuccess: () => setShareUrl(joinUrl('invite', token)) })
          }}
          disabled={invitation.isPending}
        >
          生成邀请链接
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const token = newJoinToken()
            application.mutate(token, { onSuccess: () => setShareUrl(joinUrl('apply', token)) })
          }}
          disabled={application.isPending}
        >
          生成申请链接
        </Button>
      </div>
      {shareUrl && (
        <Input
          aria-label="新生成的链接"
          readOnly
          value={shareUrl}
          onFocus={(event) => event.target.select()}
        />
      )}
      {(invitation.isError || application.isError) && (
        <p className="text-sm text-destructive">生成链接失败</p>
      )}
      <LinkRows
        title="邀请链接"
        rows={invitations.data?.items ?? []}
        revoke={(id, version) => revokeInvitation.mutate({ id, version })}
      />
      <LinkRows
        title="申请链接"
        rows={links.data?.items ?? []}
        revoke={(id, version) => revokeLink.mutate({ id, version })}
      />
      <h3 className="font-medium">待审批申请</h3>
      {requests.data?.items
        .filter((request) => request.status === 'pending')
        .map((request) => (
          <div key={request.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{request.displayName || request.userId}</span>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({ id: request.id, version: request.version, decision: 'approve' })
              }
            >
              批准
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({ id: request.id, version: request.version, decision: 'reject' })
              }
            >
              拒绝
            </Button>
          </div>
        ))}
      {(revokeInvitation.isError || revokeLink.isError || decide.isError) && (
        <p className="text-sm text-destructive">操作失败，请刷新后重试</p>
      )}
    </section>
  )
}

/** Shows revocable metadata without attempting to retrieve plaintext tokens. */
function LinkRows({
  title,
  rows,
  revoke,
}: {
  title: string
  rows: {
    id: string
    expiresAt: string
    revokedAt?: string | null
    consumedAt?: string | null
    version: number
  }[]
  revoke: (id: string, version: number) => void
}) {
  return (
    <div className="space-y-1">
      <h3 className="font-medium">{title}</h3>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1">
            {row.consumedAt && '已兑换'}
            {!row.consumedAt && row.revokedAt && '已撤销'}
            {!row.consumedAt &&
              !row.revokedAt &&
              `到期于 ${new Date(row.expiresAt).toLocaleDateString()}`}
          </span>
          {!row.revokedAt && !row.consumedAt && (
            <Button size="sm" variant="outline" onClick={() => revoke(row.id, row.version)}>
              撤销
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
