import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/msw-server'
import type {
  AssistSuggestion,
  CollaborationTargetSummary,
  FormDescriptor,
  IssueInteraction,
  IssueRun,
} from '@/features/issues/types'
import { WorkflowInteractionComposer } from './workflow-interaction-composer'

const target: CollaborationTargetSummary = {
  type: 'workflow',
  id: 'wf1',
  displayName: 'Security Review Workflow',
  description: 'demo',
  interactionDescriptor: { mode: 'form', requiresTask: false, formRef: 'security-review' },
}

/**
 * A descriptor with deliberately chosen keys: the renderer must draw exactly what it declares, which is
 * how we prove no workflow id is hard-coded in the frontend.
 */
const descriptor: FormDescriptor = {
  formRef: 'security-review',
  title: 'Security Review',
  description: 'fixture descriptor',
  fields: [
    { key: 'repository', label: 'Repository', type: 'text', required: true },
    {
      key: 'scope',
      label: 'Review scope',
      type: 'select',
      required: true,
      options: [
        { value: 'current-issue', label: 'Current issue changes' },
        { value: 'changed-files', label: 'Changed files' },
        { value: 'full-repo', label: 'Full repository' },
      ],
    },
    {
      key: 'severity',
      label: 'Severity',
      type: 'select',
      required: false,
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
    },
    { key: 'notes', label: 'Notes', type: 'textarea', required: false },
  ],
}

/**
 * The descriptor the backend projects once the form is opened *for an issue*: the platform's two
 * fields lead it, prefilled from the issue's project repository and the workflow's Start prompt. They
 * are ordinary fields as far as the renderer is concerned — that is the point of projecting them into
 * the descriptor rather than special-casing them in the UI.
 */
const platformDescriptor: FormDescriptor = {
  formRef: 'security-review',
  fields: [
    {
      key: 'repository',
      label: '仓库地址',
      type: 'text',
      required: true,
      defaultValue: 'https://github.com/ora/cloud',
    },
    {
      key: 'prompt',
      label: '提示词',
      type: 'textarea',
      required: false,
      defaultValue: 'Review the diff',
    },
    { key: 'notes', label: 'Notes', type: 'textarea', required: false },
  ],
}

/**
 * The same descriptor once the launch fields are added: a required branch, the workflow's published
 * versions to run, and the references this run may carry on top of the issue's own. They are ordinary
 * fields too — the only one the surface reads back out is `context_refs`.
 */
const launchDescriptor: FormDescriptor = {
  formRef: 'security-review',
  fields: [
    {
      key: 'repository',
      label: '仓库地址',
      type: 'text',
      required: true,
      defaultValue: 'https://github.com/ora/cloud',
    },
    { key: 'branch', label: '分支', type: 'text', required: true, defaultValue: 'main' },
    {
      key: 'version',
      label: '运行版本',
      type: 'select',
      required: false,
      defaultValue: 'snap-3',
      options: [
        { value: 'snap-3', label: 'v3 · 发布 3' },
        { value: 'snap-2', label: 'v2 · 发布 2' },
      ],
    },
    {
      key: 'prompt',
      label: '提示词',
      type: 'textarea',
      required: false,
      defaultValue: 'Review the diff',
    },
    {
      key: 'context_refs',
      label: '补充上下文引用',
      type: 'multi_select',
      required: false,
      options: [
        { value: 'project:p1', label: '本项目' },
        { value: 'parent_issue:p2', label: '父任务' },
      ],
    },
  ],
}

const suggestion: AssistSuggestion = {
  suggestedValues: { scope: 'changed-files', severity: 'high' },
  suggestedContextRefs: [],
  explanations: { scope: 'because scope', severity: 'because severity' },
}

/** A suggestion that proposes one reference the user can also tick in the form, to prove the dedup. */
const refSuggestion: AssistSuggestion = {
  suggestedValues: {},
  suggestedContextRefs: [{ refType: 'project', refId: 'p1' }],
  explanations: {},
}

const interaction: IssueInteraction = {
  id: 'ix1',
  tenantId: 't1',
  issueId: 'i1',
  commentId: 'c1',
  targetType: 'workflow',
  targetId: 'wf1',
  mode: 'form',
  task: '',
  runId: null,
  input: {},
  createdAt: '2026-01-01T00:00:00.000Z',
}

function run(): IssueRun {
  return {
    id: 'r1',
    tenantId: 't1',
    issueId: 'i1',
    executorType: 'workflow',
    executorId: 'wf1',
    input: {},
    status: 'queued',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Serves the descriptor plus assist/comment/interactions/confirm; returns spies on the mutations. */
function serveComposer(overrides: { descriptor?: unknown; suggestion?: AssistSuggestion } = {}) {
  const assist = vi.fn<(body: unknown) => void>()
  const comment = vi.fn<(body: unknown) => void>()
  const confirm = vi.fn<(body: unknown) => void>()
  server.use(
    http.get('/api/v1/tenants/t1/collaboration/forms/security-review', () =>
      HttpResponse.json(overrides.descriptor ?? descriptor),
    ),
    http.post('/api/v1/tenants/t1/issues/i1/collaboration/assist', async ({ request }) => {
      assist(await request.json())
      return HttpResponse.json(overrides.suggestion ?? suggestion)
    }),
    http.post('/api/v1/tenants/t1/issues/i1/comments', async ({ request }) => {
      comment(await request.json())
      return HttpResponse.json({ resource: { id: 'c1' } })
    }),
    http.get('/api/v1/tenants/t1/issues/i1/interactions', () =>
      HttpResponse.json({ items: [interaction], nextCursor: '' }),
    ),
    http.post('/api/v1/tenants/t1/issues/i1/interactions/ix1/confirm', async ({ request }) => {
      confirm(await request.json())
      return HttpResponse.json({ resource: run() })
    }),
  )
  return { assist, comment, confirm }
}

function renderComposer() {
  const onConfirmed = vi.fn<() => void>()
  const onRemove = vi.fn<() => void>()
  renderWithProviders(
    <WorkflowInteractionComposer
      slug="t1"
      issueId="i1"
      target={target}
      onConfirmed={onConfirmed}
      onRemove={onRemove}
    />,
  )
  return { onConfirmed, onRemove }
}

/** Anchors on a suggestion's explanation text to scope assertions to one suggestion row. */
function suggestionRow(explanation: string): HTMLElement {
  const node = screen.getByText(explanation).parentElement
  if (!node) throw new Error('suggestion row not found')
  return node
}

/** The Select trigger is labelled by its field label through the generated `workflow-field-<key>` id. */
function selectTrigger(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(label))
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Repository/), 'ora-space/cloud')
  await user.click(selectTrigger('Review scope'))
  await user.click(await screen.findByRole('option', { name: 'Changed files' }))
}

/** The two clicks every confirm goes through: into Review, then the confirm itself. */
async function reviewAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '审阅' }))
  await user.click(await screen.findByRole('button', { name: '确认执行' }))
}

describe('WorkflowInteractionComposer', () => {
  it('renders exactly the fields the descriptor declares', async () => {
    serveComposer()
    renderComposer()

    expect(await screen.findByText('Security Review')).toBeInTheDocument()
    expect(screen.getByLabelText(/Repository/)).toBeInTheDocument()
    expect(screen.getByText('Review scope')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
  })

  it('surfaces an unsupported field type instead of guessing at it', async () => {
    serveComposer({
      descriptor: {
        formRef: 'security-review',
        fields: [{ key: 'weird', label: 'Weird', type: 'date', required: false }],
      },
    })
    renderComposer()

    expect(await screen.findByText(/不支持的字段类型/)).toBeInTheDocument()
  })

  it('gates Review on the required fields', async () => {
    serveComposer()
    const user = userEvent.setup()
    renderComposer()

    const review = await screen.findByRole('button', { name: '审阅' })
    expect(review).toBeDisabled()
    await fillRequired(user)
    expect(review).toBeEnabled()
  })

  it('shows suggestions, applies one, ignores another, and writes nothing', async () => {
    const { assist, comment, confirm } = serveComposer()
    const user = userEvent.setup()
    renderComposer()

    await user.click(await screen.findByRole('button', { name: 'AI Assist' }))
    expect(await screen.findByText('because scope')).toBeInTheDocument()
    expect(assist).toHaveBeenCalledWith({ targetId: 'wf1', values: {} })

    await user.click(within(suggestionRow('because scope')).getByRole('button', { name: '应用' }))
    expect(await screen.findByText('Changed files')).toBeInTheDocument()
    await user.click(
      within(suggestionRow('because severity')).getByRole('button', { name: '忽略' }),
    )
    expect(screen.queryByText('because severity')).not.toBeInTheDocument()

    // A draft form writes nothing: no comment, no interaction, no run.
    expect(comment).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('writes nothing when the draft is abandoned', async () => {
    const { comment, confirm } = serveComposer()
    const user = userEvent.setup()
    const { onRemove } = renderComposer()

    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(comment).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalled()
  })

  it('prefills the platform fields and gates Review on the repository alone', async () => {
    const { confirm } = serveComposer({ descriptor: platformDescriptor })
    const user = userEvent.setup()
    renderComposer()

    const repository = await screen.findByLabelText(/仓库地址/)
    expect(repository).toHaveValue('https://github.com/ora/cloud')
    const prompt = screen.getByLabelText(/提示词/)
    expect(prompt).toHaveValue('Review the diff')

    // The prompt is optional: clearing it is how the run says "use the workflow's own Start prompt".
    await user.clear(prompt)
    expect(screen.getByRole('button', { name: '审阅' })).toBeEnabled()

    // The repository is not optional, and an issue whose project has no repository arrives empty.
    await user.clear(repository)
    expect(screen.getByRole('button', { name: '审阅' })).toBeDisabled()
    await user.type(repository, 'ora-space/cloud')

    await reviewAndConfirm(user)

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({
        values: { repository: 'ora-space/cloud', prompt: '' },
      }),
    )
  })

  it('requires an explicit Review, and Confirm creates the comment + interaction + run once', async () => {
    const { comment, confirm } = serveComposer()
    const user = userEvent.setup()
    const { onConfirmed } = renderComposer()

    await fillRequired(user)
    expect(confirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '审阅' }))
    expect(await screen.findByText('确认后才会创建执行（IssueRun）')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '返回修改' }))
    expect(await screen.findByRole('button', { name: '审阅' })).toBeInTheDocument()

    await reviewAndConfirm(user)

    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    expect(comment).toHaveBeenCalledWith({
      body: '@Security Review Workflow',
      targets: [{ type: 'workflow', id: 'wf1' }],
    })
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({
        values: { repository: 'ora-space/cloud', scope: 'changed-files' },
      }),
    )
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
  })

  it('prefills the branch and the newest published version, and gates Review on the branch too', async () => {
    const { confirm } = serveComposer({ descriptor: launchDescriptor })
    const user = userEvent.setup()
    renderComposer()

    const branch = await screen.findByLabelText(/分支/)
    expect(branch).toHaveValue('main')
    // The version opens on the newest published snapshot, shown by its version number.
    expect(selectTrigger('运行版本')).toHaveTextContent('v3 · 发布 3')

    // The branch pairs with the repository: clearing it gates Review exactly as clearing that does.
    await user.clear(branch)
    expect(screen.getByRole('button', { name: '审阅' })).toBeDisabled()
    await user.type(branch, 'release/1.0')

    await reviewAndConfirm(user)

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({
        values: {
          repository: 'https://github.com/ora/cloud',
          branch: 'release/1.0',
          version: 'snap-3',
          prompt: 'Review the diff',
        },
      }),
    )
  })

  it('carries the ticked context references, once each even when Assist suggested one too', async () => {
    const { confirm } = serveComposer({
      descriptor: launchDescriptor,
      suggestion: refSuggestion,
    })
    const user = userEvent.setup()
    renderComposer()

    // Assist suggests the project reference, which the user applies and then also ticks below: the run
    // must receive it once, because it appends what it is given without checking.
    await user.click(await screen.findByRole('button', { name: 'AI Assist' }))
    await user.click(await screen.findByRole('button', { name: '应用' }))
    expect(await screen.findByText('已应用')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: '本项目' }))
    await user.click(screen.getByRole('checkbox', { name: '父任务' }))

    await reviewAndConfirm(user)

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({
        values: {
          repository: 'https://github.com/ora/cloud',
          branch: 'main',
          version: 'snap-3',
          prompt: 'Review the diff',
          context_refs: ['project:p1', 'parent_issue:p2'],
        },
        contextRefs: [
          { refType: 'project', refId: 'p1' },
          { refType: 'parent_issue', refId: 'p2' },
        ],
      }),
    )
  })
})
