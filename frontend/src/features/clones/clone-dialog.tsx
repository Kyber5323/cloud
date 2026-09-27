import { useState } from 'react'
import { DialogFormField } from '@/components/common/dialog-form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { STORAGE_UNREADABLE_NOTICE } from '@/features/clones/messages'
import type { CloneSubmission } from '@/features/clones/pending'
import type { CloneInput, CloneSubmissionFlow } from '@/features/clones/use-clone-submission'

/**
 * Quick feedback mirroring Cloud's clone source rules; Cloud stays authoritative and explains any
 * refusal by its fault code.
 */
function repositoryHint(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '' || /^(https|ssh):\/\/\S+$/.test(trimmed)) return undefined
  return '仅支持 https:// 或 ssh:// 地址，且不能包含空白'
}

function branchHint(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed === 'HEAD' || trimmed.startsWith('refs/') || /\s/.test(trimmed)) {
    return '请填写分支短名，如 main'
  }
  return undefined
}

/** Repository and branch fields for a new submission. */
function CloneFields({
  onSubmit,
  busy,
  blocked,
}: {
  onSubmit: (input: CloneInput) => void
  busy: boolean
  blocked: boolean
}) {
  const [repository, setRepository] = useState('')
  const [branch, setBranch] = useState('main')
  const repositoryError = repositoryHint(repository)
  const branchError = branchHint(branch)
  const submittable =
    repository.trim() !== '' &&
    branch.trim() !== '' &&
    !repositoryError &&
    !branchError &&
    !busy &&
    !blocked

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (submittable) onSubmit({ repository, branch })
      }}
      className="space-y-4"
    >
      <DialogFormField
        id="clone-repository"
        label="仓库 URL（HTTPS 或 SSH）"
        value={repository}
        onChange={setRepository}
        placeholder="https://github.com/octocat/Hello-World"
        hint={repositoryError}
        required
      />
      <DialogFormField
        id="clone-branch"
        label="分支"
        value={branch}
        onChange={setBranch}
        placeholder="main"
        hint={branchError}
        required
      />
      <Button type="submit" className="w-full" disabled={!submittable}>
        {busy ? '提交中…' : '提交'}
      </Button>
    </form>
  )
}

/** The unconfirmed submission, read-only, with the only safe action: resend it unchanged. */
function UnconfirmedSubmission({
  submission,
  busy,
  onRetry,
}: {
  submission: CloneSubmission
  busy: boolean
  onRetry: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs">
        <p className="font-medium">尚未确认的提交</p>
        <p className="break-all text-muted-foreground">{submission.repository}</p>
        <p className="font-mono text-muted-foreground">{submission.branch}</p>
      </div>
      <Button className="w-full" disabled={busy} onClick={onRetry}>
        {busy ? '提交中…' : '重试原请求'}
      </Button>
    </div>
  )
}

/**
 * Dialog for cloning a repository. While the tab holds an unconfirmed submission it offers only
 * to resend that submission, never a new one; it closes once Cloud accepted a submission, and the
 * list shows the result.
 */
export function CloneDialog({
  open,
  onOpenChange,
  flow,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flow: CloneSubmissionFlow
}) {
  async function send(input: CloneInput) {
    if (await flow.submit(input)) onOpenChange(false)
  }
  const pending = flow.pending
  const blocked = pending.status === 'unreadable'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Clone 仓库</DialogTitle>
          <DialogDescription>
            由 Node clone 指定分支并保留完整历史，结果显示在列表中。
          </DialogDescription>
        </DialogHeader>
        {pending.status === 'unconfirmed' ? (
          <UnconfirmedSubmission
            submission={pending.submission}
            busy={flow.busy}
            onRetry={() => void send(pending.submission)}
          />
        ) : (
          <CloneFields onSubmit={(input) => void send(input)} busy={flow.busy} blocked={blocked} />
        )}
        {blocked && <p className="text-xs text-destructive">{STORAGE_UNREADABLE_NOTICE}</p>}
        {flow.notice && <p className="text-xs text-destructive">{flow.notice}</p>}
      </DialogContent>
    </Dialog>
  )
}
