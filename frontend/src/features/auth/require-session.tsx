import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '@/features/auth/session'
import { joinedLinkPath, loginPath, PENDING_JOIN_PATH_KEY } from '@/lib/paths'

/**
 * Route gate: renders `children` only for a signed-in session. While the
 * probe is pending nothing is rendered, so a page never flashes with an
 * unknown identity; a signed-out tab goes to the login page with the current
 * location as `returnTo`; a disabled account and an unreachable backend are
 * reported in place, because neither is fixed by logging in again.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session } = useSession()
  const location = useLocation()
  if (session.status === 'loading') return null
  if (session.status === 'signed-out') {
    const joinPath = joinedLinkPath(location.pathname)
    if (joinPath) {
      // Gateway persists returnTo in login attempts. Keep the bearer link in
      // this browser tab and give Gateway only a tokenless return path.
      try {
        sessionStorage.setItem(PENDING_JOIN_PATH_KEY, joinPath)
      } catch {
        return <Navigate to={loginPath('/onboarding')} replace />
      }
      return <Navigate to={loginPath('/join/continue')} replace />
    }
    return <Navigate to={loginPath(location.pathname + location.search)} replace />
  }
  if (session.status === 'disabled') {
    return (
      <div className="flex h-svh items-center justify-center bg-muted/30">
        <p className="text-sm text-muted-foreground">账号已被停用，请联系管理员恢复访问</p>
      </div>
    )
  }
  if (session.status === 'unavailable') {
    return (
      <div className="flex h-svh items-center justify-center bg-muted/30">
        <p className="text-sm text-muted-foreground">无法连接服务端，请稍后刷新重试</p>
      </div>
    )
  }
  return children
}
