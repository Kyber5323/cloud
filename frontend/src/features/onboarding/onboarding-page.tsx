import { useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSession } from '@/features/auth/session'
import { useLoginProviders } from '@/features/auth/providers'
import { useMyJoinRequests } from '@/features/onboarding/api'
import { useCreateTenant, useJoinedSpaces } from '@/features/spaces/api'
import { isValidSlug, slugFromName } from '@/features/spaces/slug'
import { joinedLinkPath, workspacePaths, workspaceUrlPrefix } from '@/lib/paths'

/**
 * Landing screen for members with no space. They can create a tenant or enter
 * a private invitation or application link shared by an administrator.
 */
export function OnboardingPage() {
  const { spaces, isPending, isError } = useJoinedSpaces()
  const providers = useLoginProviders()

  if (isPending) return null
  if (isError) {
    return (
      <Shell>
        <p className="text-sm text-destructive">无法加载你的工作区，请刷新重试</p>
      </Shell>
    )
  }
  const existing = spaces?.[0]
  if (existing) return <Navigate to={workspacePaths(existing.slug).issues} replace />
  return (
    <Shell>
      <CreateFirstWorkspace corporate={providers.data?.includes('huawei-idaas')} />
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md space-y-6">{children}</div>
    </div>
  )
}

/**
 * Creates a tenant and its sole space and yields its immutable slug.
 */
function useCreateFirstWorkspace() {
  const createTenant = useCreateTenant()
  const errorCode = createTenant.error?.response?.data?.code

  function create(input: { name: string; slug: string }, onCreated: (slug: string) => void) {
    createTenant.mutate(input, { onSuccess: (created) => onCreated(created.space.slug) })
  }

  return { create, pending: createTenant.isPending, errorCode }
}

/**
 * Name + slug form. The slug follows the name until the user edits it, and
 * the URL preview shows exactly where the workspace will live.
 */
function CreateFirstWorkspace({ corporate }: { corporate: boolean | undefined }) {
  const navigate = useNavigate()
  const { session, signOut } = useSession()
  const { create, pending, errorCode } = useCreateFirstWorkspace()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const submittable = name.trim() !== '' && isValidSlug(slug) && !pending
  const displayName = session.status === 'signed-in' ? session.user.displayName : ''

  function updateName(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugFromName(value))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!submittable) return
        create(
          { name: name.trim(), slug },
          (created) => void navigate(workspacePaths(created).issues),
        )
      }}
      className="space-y-6"
    >
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">创建或加入协作空间</h1>
        <p className="text-sm text-muted-foreground">
          {displayName ? `${displayName}，` : ''}
          协作空间承载项目、成员和任务。创建后你将成为管理员。
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="onboarding-name">工作区名称</Label>
        <Input
          id="onboarding-name"
          value={name}
          onChange={(e) => updateName(e.target.value)}
          placeholder="Acme Inc"
          autoFocus
          required
        />
      </div>
      <SlugField
        slug={slug}
        onChange={(value) => {
          setSlugTouched(true)
          setSlug(value)
        }}
      />
      {errorCode && <p className="text-xs text-destructive">创建失败：{errorCode}</p>}
      <Button type="submit" className="w-full" disabled={!submittable}>
        {pending ? '创建中…' : '创建工作区'}
      </Button>
      {corporate === true && (
        <p className="text-sm text-muted-foreground">
          如需加入已有协作空间，请联系空间管理员通过华为人员目录添加你。
        </p>
      )}
      {corporate === false && <JoinLinkEntry />}
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        disabled={pending}
        onClick={() => void signOut()}
      >
        退出登录
      </Button>
    </form>
  )
}

/** Navigates only to this application's supported private join-link routes. */
function JoinLinkEntry() {
  const navigate = useNavigate()
  const requests = useMyJoinRequests()
  const [link, setLink] = useState('')
  const [invalid, setInvalid] = useState(false)
  return (
    <div className="space-y-2 border-t pt-4">
      <Label htmlFor="join-link">加入已有协作空间</Label>
      <Input
        id="join-link"
        value={link}
        onChange={(event) => setLink(event.target.value)}
        placeholder="粘贴管理员分享的链接"
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          const path = joinedLinkPath(link)
          setInvalid(!path)
          if (path) void navigate(path)
        }}
      >
        打开加入链接
      </Button>
      {invalid && <p className="text-xs text-destructive">请输入有效的邀请或申请链接</p>}
      {requests.data?.items
        .filter((request) => request.status === 'pending')
        .map((request) => (
          <p key={request.id} className="text-sm text-muted-foreground">
            {request.name}：等待管理员审批
          </p>
        ))}
    </div>
  )
}

/**
 * URL field: the reserved `host/w/` prefix is rendered as a fixed adornment
 * and only the slug after it is editable, so what the member types is exactly
 * what the final address ends with.
 */
function SlugField({ slug, onChange }: { slug: string; onChange: (slug: string) => void }) {
  const invalid = slug !== '' && !isValidSlug(slug)
  return (
    <div className="space-y-1.5">
      <Label htmlFor="onboarding-slug">工作区地址（创建后不可修改）</Label>
      <div className="flex h-8 items-stretch rounded-lg border border-input bg-transparent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <span
          aria-hidden="true"
          className="flex select-none items-center whitespace-nowrap rounded-l-lg border-r border-input bg-muted/60 px-2.5 font-mono text-sm text-muted-foreground"
        >
          {workspaceUrlPrefix()}
        </span>
        <Input
          id="onboarding-slug"
          value={slug}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          placeholder="acme"
          aria-invalid={invalid || undefined}
          aria-describedby="onboarding-slug-hint"
          className="h-auto rounded-l-none border-0 font-mono focus-visible:ring-0"
          required
        />
      </div>
      <p id="onboarding-slug-hint" className="text-xs text-muted-foreground">
        {invalid
          ? '小写字母、数字与连字符，以字母或数字开头，最多 64 个字符'
          : `完整地址：${workspaceUrlPrefix()}${slug || 'acme'}`}
      </p>
    </div>
  )
}
