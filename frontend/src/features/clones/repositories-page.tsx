import { Plus } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/features/auth/session'
import { useCloneList } from '@/features/clones/api'
import { CloneDialog } from '@/features/clones/clone-dialog'
import { CloneList } from '@/features/clones/clone-list'
import { pendingSubmissionKey } from '@/features/clones/pending'
import { useCloneSubmission } from '@/features/clones/use-clone-submission'
import { useCurrentSpace } from '@/features/spaces/current-space'

/** One member's clones page once the tenant and user are known. */
function RepositoriesView({ tenantId, userId }: { tenantId: string; userId: string }) {
  const list = useCloneList(tenantId)
  const flow = useCloneSubmission({ tenantId, userId, operations: list.data?.operations })
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <PageHeader
        title="仓库"
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3.5" />
            Clone 仓库
          </Button>
        }
      />
      <CloneDialog open={dialogOpen} onOpenChange={setDialogOpen} flow={flow} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs text-muted-foreground">
          仅你本人可见。关闭页面不会取消已接受的 clone；失败时的残留目录不会自动删除。
        </p>
        {flow.pending.status === 'unconfirmed' && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-xs">
            <span>有一个 clone 请求尚未确认是否被接受。</span>
            <Button size="xs" variant="outline" onClick={() => setDialogOpen(true)}>
              查看并重试
            </Button>
          </div>
        )}
        <CloneList
          operations={list.data?.operations}
          truncated={list.data?.truncated ?? false}
          stale={list.isError}
        />
      </div>
    </>
  )
}

/**
 * The 仓库 page: clone a repository onto a Node and follow the result. Clones belong to the
 * submitting member within the tenant behind the current space, so the list does not change
 * between spaces of one tenant. Nothing is requested until the route slug resolved to a joined
 * space and the session names the member.
 */
export function RepositoriesPage({ slug }: { slug: string }) {
  const { tenantId, space } = useCurrentSpace()
  const { session } = useSession()
  const userId = session.status === 'signed-in' ? session.user.id : undefined

  return (
    <div className="flex h-full flex-col">
      {space?.slug === slug && tenantId && userId ? (
        // Keyed by the storage key: another tenant or user must re-read its own pending submission.
        <RepositoriesView
          key={pendingSubmissionKey(tenantId, userId)}
          tenantId={tenantId}
          userId={userId}
        />
      ) : (
        <>
          <PageHeader title="仓库" />
          <div className="p-4">
            <Skeleton className="h-10 w-full" />
          </div>
        </>
      )}
    </div>
  )
}
