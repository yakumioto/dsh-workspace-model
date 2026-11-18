// @ts-check
/**
 * Per-workspace default model.
 *
 * A workspace may name the model its new sessions start from. The choice is
 * stored in this plugin's Config (the `workspace-model` settings
 * namespace), so the Models settings UI can read and write it like any other
 * plugin setting.
 *
 * Two moments can start a conversation, and both need the same treatment:
 *
 * - `agent/created` covers a freshly minted Session and a blank Session
 *   restored from storage (`source` "startup" or "resume").
 * - The Web reuses a blank Session that is still live, which returns the
 *   existing Agent without any creation event. `agent/inbox/claimed` runs
 *   inside the first step, synchronously before the step reads the model
 *   selection, so it can still record one in time. That listener must stay
 *   synchronous: the registry lookup is done against an in-memory snapshot.
 *
 * A session that already ran a turn keeps its selection, and a workspace
 * without an entry is left to the deployment default.
 *
 * @module @yakumioto/dsh-workspace-model
 */

import z from '@deepseek-ai/schemastery'

export const name = 'workspace-model'


/**
 * @typedef {object} WorkspaceDefault
 * @property {string} workspaceId Stable WorkspaceId the override belongs to.
 * @property {string} provider Provider id of the model to record.
 * @property {string} model Model id to record.
 * @property {string} [reasoningEffort] Optional effort level.
 */

/**
 * @typedef {object} ModelSelection
 * @property {string} provider
 * @property {string} model
 * @property {string} [reasoningEffort]
 */

/**
 * @typedef {object} HostContext
 * @property {{ resolveByPath(path: string): Promise<{ id: string } | undefined>, list(): readonly { id: string, path: string }[] }} workspaceRegistry
 * @property {{ snapshot(session: unknown, keys?: readonly string[]): { values: { modelSelection?: { lastUsed?: unknown, next?: unknown } } } }} sessionProjections
 * @property {{ warn(message: string, ...args: unknown[]): void }} logger
 * @property {(event: string, listener: (...args: any[]) => unknown) => void} on
 */

/**
 * @typedef {object} AgentContext
 * @property {{ header: { cwd?: string, origin?: string }, requestHeader(): unknown }} session
 * @property {{ select(selection: ModelSelection): void }} model
 */

/**
 * @typedef {object} PluginConfig
 * @property {{ get(): readonly WorkspaceDefault[] }} workspaceDefaults
 */

/** Services read while resolving a workspace and its recorded selection. */
export const inject = ['workspaceRegistry', 'sessionProjections']

/** One workspace override, keyed by the stable WorkspaceId. */
export const workspaceDefaultSchema = z.object({
  workspaceId: z.string().required(),
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** Settings-shaped Config: the Models footer edits this array through the settings namespace. */
export const Config = z.object({
  workspaceDefaults: z.array(workspaceDefaultSchema).default([]).volatile(),
})

/**
 * Build a detached model selection from one stored entry.
 * @param {WorkspaceDefault} entry - One workspace override.
 * @returns {ModelSelection} the selection to record on the Agent.
 */
function selectionOf(entry) {
  return entry.reasoningEffort == null || entry.reasoningEffort === ''
    ? { provider: entry.provider, model: entry.model }
    : { provider: entry.provider, model: entry.model, reasoningEffort: entry.reasoningEffort }
}

/**
 * The cwd of an Agent that has not started its first turn, if it may take a
 * workspace default. Returns undefined for every Agent that must be left alone.
 * @param {HostContext} ctx - Host context.
 * @param {AgentContext} agent - Agent to inspect.
 * @returns {string | undefined} the cwd of a blank Agent, or undefined.
 */
function blankAgentCwd(ctx, agent) {
  const header = agent.session.header
  // Delegated work inherits its parent's model; a workspace default is for the
  // session a person starts, not for the agents it spawns.
  if (header.origin === 'subagent') return undefined
  const cwd = header.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  // A session that already ran a turn keeps whatever it ran with.
  if (agent.session.requestHeader() !== undefined) return undefined
  const recorded = ctx.sessionProjections.snapshot(agent.session, ['modelSelection']).values.modelSelection
  // `next` is `pending ?? lastUsed`; either one means the session already has a
  // selection (for example a model the person picked before sending) that must
  // win over a workspace default.
  if (recorded !== undefined && (recorded.lastUsed != null || recorded.next != null)) return undefined
  return cwd
}

/**
 * Record the workspace's model selection on a new Agent when it has none.
 * Async because the registry canonicalizes the directory it is asked about.
 * @param {HostContext} ctx - Host context.
 * @param {PluginConfig} config - Live plugin Config; read through `workspaceDefaults.get()`.
 * @param {AgentContext} agent - Agent whose creation emitted `agent/created`.
 * @returns {Promise<void>} resolves after the Agent is left alone or given a selection.
 */
export async function applyWorkspaceDefault(ctx, config, agent) {
  const cwd = blankAgentCwd(ctx, agent)
  if (cwd === undefined) return

  let workspace
  try {
    workspace = await ctx.workspaceRegistry.resolveByPath(cwd)
  } catch {
    // A session whose directory disappeared keeps the deployment default.
    return
  }
  if (workspace === undefined) return

  const entries = config.workspaceDefaults.get() ?? []
  const entry = entries.find(candidate => candidate.workspaceId === workspace.id)
  if (entry === undefined) return

  agent.model.select(selectionOf(entry))
}

/**
 * Synchronous sibling of {@link applyWorkspaceDefault} for the inbox-claim
 * path, where the step reads its selection as soon as the listener returns.
 * @param {HostContext} ctx - Host context.
 * @param {PluginConfig} config - Live plugin Config.
 * @param {AgentContext} agent - Agent about to claim its first message.
 * @returns {void} leaves the Agent untouched unless every guard passes.
 */
export function applyWorkspaceDefaultSync(ctx, config, agent) {
  const cwd = blankAgentCwd(ctx, agent)
  if (cwd === undefined) return

  // The registry list is an in-memory snapshot, so this stays synchronous. A
  // blank Session started from the Web carries the Workspace's canonical path.
  const workspace = ctx.workspaceRegistry.list().find(candidate => candidate.path === cwd)
  if (workspace === undefined) return

  const entries = config.workspaceDefaults.get() ?? []
  const entry = entries.find(candidate => candidate.workspaceId === workspace.id)
  if (entry === undefined) return

  agent.model.select(selectionOf(entry))
}

/**
 * Subscribe to the two starts a conversation can have.
 * @param {HostContext} ctx - Host context.
 * @param {PluginConfig} config - Validated plugin Config.
 */
export function apply(ctx, config) {
  /** @param {{ agent: AgentContext, source: string }} payload */
  const onCreated = async ({ agent, source }) => {
    // `clear` and `compact` continue within a session that already ran, so the
    // request-header guard would reject them anyway; name the two starts.
    if (source !== 'startup' && source !== 'resume') return
    try {
      await applyWorkspaceDefault(ctx, config, agent)
    } catch (error) {
      // Never fail session creation because a default could not be applied.
      ctx.logger.warn('workspace-model: %s', error instanceof Error ? error.message : String(error))
    }
  }

  /** @param {{ agent: AgentContext }} payload */
  const onClaimed = ({ agent }) => {
    try {
      applyWorkspaceDefaultSync(ctx, config, agent)
    } catch (error) {
      ctx.logger.warn('workspace-model: %s', error instanceof Error ? error.message : String(error))
    }
  }

  ctx.on('agent/created', onCreated)
  ctx.on('agent/inbox/claimed', onClaimed)
}
