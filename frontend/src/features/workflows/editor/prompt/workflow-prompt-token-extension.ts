import { ReactNodeViewRenderer } from '@tiptap/react'
import { PromptToken } from '@/features/workflows/editor/prompt/prompt-token'
import { PromptTokenNodeView } from '@/features/workflows/editor/prompt/prompt-token-node-view'

/** PromptToken variant used by the workflow prompt editor, rendered via React. */
export const WorkflowPromptVariableToken = PromptToken.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PromptTokenNodeView)
  },
})
