import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkflow } from '@/features/workflows/api'
import { WorkflowEditor } from '@/features/workflows/editor/workflow-editor'
import { workspacePaths } from '@/lib/paths'

/**
 * The workflow a member opened, in the editor.
 *
 * The page owns the fetch and nothing else: it resolves the workflow, then hands
 * the loaded record to the editor, which owns the draft from that point on. The
 * editor is keyed by workflow id so opening a different workflow starts a fresh
 * draft instead of carrying the previous one's nodes across.
 *
 * @param props.slug - Tenant id the workflow belongs to.
 */
export function WorkflowEditorPage({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { workspaceSlug, workflowId } = useParams<{ workspaceSlug: string; workflowId: string }>()
  const paths = workspacePaths(workspaceSlug ?? slug)
  const workflow = useWorkflow(slug, workflowId)
  const title = t('workflows.list.title')
  const breadcrumb = { label: title, to: paths.workflows }

  if (workflow.isPending) {
    return (
      <WorkflowPageShell title={title} breadcrumb={breadcrumb}>
        <div className="flex-1 p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      </WorkflowPageShell>
    )
  }

  if (!workflow.data) {
    return (
      <WorkflowPageShell title={title} breadcrumb={breadcrumb}>
        <p className="p-4 text-sm text-muted-foreground">{t('workflows.detail.notFound')}</p>
      </WorkflowPageShell>
    )
  }

  return (
    <WorkflowPageShell title={workflow.data.name} breadcrumb={breadcrumb}>
      <WorkflowEditor
        key={workflow.data.id}
        tenantId={slug}
        workflow={workflow.data}
        onImported={(importedId) => navigate(paths.workflowDetail(importedId))}
      />
    </WorkflowPageShell>
  )
}

/** The header and full-height column every state of the page shares. */
function WorkflowPageShell({
  title,
  breadcrumb,
  children,
}: {
  title: string
  breadcrumb: { label: string; to: string }
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} breadcrumb={breadcrumb} />
      {children}
    </div>
  )
}
