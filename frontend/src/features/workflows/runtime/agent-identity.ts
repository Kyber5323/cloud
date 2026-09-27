/**
 * Names the agents the workflow editor offers, in the spelling the backend reports.
 *
 * An agent is identified by its supplying package's whole `namespace/name` id, never by the bare
 * name: two marketplace sources may publish the same name, and the name alone would collapse them
 * into a single agent. Everything that names an agent goes through this helper so the shape lives
 * in one place rather than being joined by hand at each call site.
 */

/** Namespace the reserved first-party marketplace installs its packages under. */
const OFFICIAL_NAMESPACE = 'official'

/** Builds the agent identity one first-party package supplies. */
export function officialAgentRef(name: string): string {
  return `${OFFICIAL_NAMESPACE}/${name}`
}

/** The agent identities the default workflow capability catalog offers. */
export const DEMO_AGENT_REF = {
  codeagentcli: officialAgentRef('ora-space.codeagentcli'),
  opencode: officialAgentRef('ora-space.opencode'),
  nga: officialAgentRef('ora-space.nga'),
} as const
