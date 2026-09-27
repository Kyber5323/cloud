/** Wire values for node failure kinds; kept in one list so i18n tests can iterate them. */
export const NODE_FAILURE_KINDS = [
  'missing_agent_ref',
  'workflow_model_not_found',
  'missing_agent_config',
  'invalid_run_payload',
  'prompt_template',
  'structured_output',
  'missing_skill_materialization',
  'session_ended_without_stop_reason',
  'session_binding_rejected',
  'baseline_persist',
  'repository',
  'session',
  'agent_refusal',
  'unknown_stop_reason',
  'interrupted_by_restart',
  'multiple_outputs',
  'condition_evaluation',
] as const

export type NodeFailureKind = (typeof NODE_FAILURE_KINDS)[number]

/**
 * Narrows an unknown persisted failure value to a known kind, or `undefined`.
 *
 * A newer runtime may report a kind this viewer does not know; the inspector then falls
 * back to showing the raw error text rather than guessing at a translation.
 */
export function asNodeFailureKind(value: unknown): NodeFailureKind | undefined {
  return isNodeFailureKind(value) ? value : undefined
}

/** Narrows an unknown value to a known failure kind via a predicate, no cast. */
function isNodeFailureKind(value: unknown): value is NodeFailureKind {
  return typeof value === 'string' && (NODE_FAILURE_KINDS as readonly string[]).includes(value)
}
