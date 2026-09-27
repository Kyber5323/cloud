import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CloneOperation } from '@/api/generated.schemas'
import { CLONE_LIST_LIMIT } from '@/features/clones/api'
import {
  CLONE_FAILURE_LABELS,
  CLONE_STAGE_LABELS,
  CLONE_STAGE_VARIANT,
  cloneStage,
} from '@/features/clones/status'

const SKELETON_KEYS = ['one', 'two', 'three', 'four']
const SHORT_COMMIT_LENGTH = 12

/**
 * The facts Cloud holds for one operation. Pending never reads as failure or progress: queued
 * waits for a Controller to claim it, dispatched waits for the Node's result.
 */
function CloneOutcome({ operation }: { operation: CloneOperation }) {
  const { state } = operation
  const stage = cloneStage(operation)
  if (stage === 'queued') return <p className="text-muted-foreground">等待 Controller 领取</p>
  if (stage === 'dispatched') {
    return <p className="text-muted-foreground">已交给 Node {operation.nodeId}，等待结果</p>
  }
  if (stage === 'succeeded') {
    return (
      <div className="space-y-0.5">
        <p className="font-mono" title={state.commit}>
          {state.commit?.slice(0, SHORT_COMMIT_LENGTH)}
        </p>
        <p className="break-all text-muted-foreground">{state.path}</p>
      </div>
    )
  }
  return (
    <div className="space-y-0.5">
      <p className="text-destructive">{CLONE_FAILURE_LABELS[state.reason ?? 'unspecified']}</p>
      {state.retainedPath && (
        <p className="break-all text-muted-foreground">残留已保留：{state.retainedPath}</p>
      )}
    </div>
  )
}

function CloneRow({ operation }: { operation: CloneOperation }) {
  const stage = cloneStage(operation)
  return (
    <TableRow>
      <TableCell className="max-w-72 whitespace-normal">
        <p className="break-all font-medium">{operation.repository}</p>
        <p className="font-mono text-xs text-muted-foreground">{operation.branch}</p>
      </TableCell>
      <TableCell>
        <Badge variant={CLONE_STAGE_VARIANT[stage]}>{CLONE_STAGE_LABELS[stage]}</Badge>
      </TableCell>
      <TableCell className="max-w-96 whitespace-normal text-xs">
        <CloneOutcome operation={operation} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {format(new Date(operation.createdAt), 'M月d日 HH:mm')}
      </TableCell>
    </TableRow>
  )
}

/**
 * The member's clone operations. `operations` is undefined until the first read settles; a
 * failed re-read keeps the last facts visible under `stale`, since Cloud's state did not change
 * just because the page could not read it.
 */
export function CloneList({
  operations,
  truncated,
  stale,
}: {
  operations: CloneOperation[] | undefined
  truncated: boolean
  stale: boolean
}) {
  return (
    <div className="space-y-3">
      {stale && (
        <p role="alert" className="text-xs text-destructive">
          暂时无法查询 clone 状态，恢复后会自动更新；已接受的 clone 不受影响。
        </p>
      )}
      {operations === undefined && !stale && (
        <div className="space-y-2">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="h-10 w-full" />
          ))}
        </div>
      )}
      {operations?.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          还没有 clone 过仓库。点击右上角「Clone 仓库」开始。
        </p>
      )}
      {operations !== undefined && operations.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>仓库</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>提交时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {operations.map((operation) => (
              <CloneRow key={operation.operationId} operation={operation} />
            ))}
          </TableBody>
        </Table>
      )}
      {truncated && (
        <p className="text-xs text-muted-foreground">仅显示其中 {CLONE_LIST_LIMIT} 条记录。</p>
      )}
    </div>
  )
}
