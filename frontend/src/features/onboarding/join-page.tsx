import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useRedeemInvitation, useRequestJoin } from '@/features/onboarding/api'
import { joinedLinkPath, PENDING_JOIN_PATH_KEY, workspacePaths } from '@/lib/paths'
import { useJoinedSpaces } from '@/features/spaces/api'

function actionLabel(kind: 'invite' | 'apply', pending: boolean): string {
  if (pending) return '处理中…'
  return kind === 'invite' ? '确认加入' : '提交申请'
}

function joinMessage(
  kind: 'invite' | 'apply',
  membershipName: string | undefined,
  applicationStatus: string | undefined,
): string {
  if (membershipName) return `已加入：${membershipName}`
  if (applicationStatus)
    return applicationStatus === 'pending'
      ? '申请状态：等待管理员审批'
      : `申请状态：${applicationStatus}`
  return kind === 'invite' ? '兑换邀请后会以普通成员身份加入。' : '提交申请后，需要空间管理员批准。'
}

function clearPendingJoin() {
  try {
    sessionStorage.removeItem(PENDING_JOIN_PATH_KEY)
  } catch {
    // Redemption already succeeded; disabled tab storage cannot undo it.
  }
}

/** Restores a private link from this tab after OAuth without storing its token in Gateway. */
export function JoinContinue() {
  let path: string | undefined
  try {
    path = joinedLinkPath(sessionStorage.getItem(PENDING_JOIN_PATH_KEY) ?? '')
  } catch {
    // Browsers that block tab storage can still paste the link after login.
  }
  return <Navigate to={path ?? '/onboarding'} replace />
}

/** Lets a signed-in user consciously redeem an invitation or request access. */
export function JoinPage({ kind }: { kind: 'invite' | 'apply' }) {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const invitation = useRedeemInvitation()
  const application = useRequestJoin()
  const { spaces } = useJoinedSpaces()
  const membership = invitation.data
  const joinedSpace = spaces?.find((space) => space.tenantId === membership?.tenantId)
  const invalid = !/^[A-Za-z0-9_-]{43}$/.test(token ?? '')
  const pending = invitation.isPending || application.isPending
  const errorCode =
    invitation.error?.response?.data?.code ?? application.error?.response?.data?.code
  const message = joinMessage(kind, membership?.name, application.data?.status)

  function submit() {
    if (!token) return
    if (kind === 'invite') invitation.mutate(token, { onSuccess: clearPendingJoin })
    else application.mutate(token, { onSuccess: clearPendingJoin })
  }

  return (
    <JoinView
      message={message}
      invalid={invalid}
      pending={pending}
      errorCode={errorCode}
      submitted={Boolean(membership || application.data)}
      action={actionLabel(kind, pending)}
      joinedSlug={joinedSpace?.slug}
      onSubmit={submit}
      onNavigate={(path) => void navigate(path)}
    />
  )
}

function JoinView({
  message,
  invalid,
  pending,
  errorCode,
  submitted,
  action,
  joinedSlug,
  onSubmit,
  onNavigate,
}: {
  message: string
  invalid: boolean
  pending: boolean
  errorCode: string | undefined
  submitted: boolean
  action: string
  joinedSlug: string | undefined
  onSubmit: () => void
  onNavigate: (path: string) => void
}) {
  return (
    <main className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="text-lg font-semibold">加入协作空间</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      {invalid && <p className="text-sm text-destructive">链接无效</p>}
      {errorCode && <p className="text-sm text-destructive">操作失败：{errorCode}</p>}
      {!submitted && (
        <Button disabled={invalid || pending} onClick={onSubmit}>
          {action}
        </Button>
      )}
      {joinedSlug && (
        <Button onClick={() => onNavigate(workspacePaths(joinedSlug).issues)}>进入空间</Button>
      )}
      <Button variant="outline" onClick={() => onNavigate('/onboarding')}>
        返回空间列表
      </Button>
    </main>
  )
}
