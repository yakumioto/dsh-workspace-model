import {
  applyWorkspaceDefault,
  applyWorkspaceDefaultSync,
} from '../lib/index.js'

function makeAgent({ cwd = '/work/a', origin, recorded, header, onSelect }) {
  const session = {
    header: { cwd, origin },
    requestHeader: () => header,
  }
  return { session, model: { select: (s) => onSelect(s) } }
}

function makeConfig(entries) {
  return { workspaceDefaults: { get: () => entries } }
}

function makeCtx({ workspace, workspaces, throwOnResolve = false, recorded }) {
  return {
    workspaceRegistry: {
      resolveByPath: async () => {
        if (throwOnResolve) throw new Error('ENOENT')
        return workspace
      },
      list: () => workspaces ?? (workspace === undefined ? [] : [workspace]),
    },
    sessionProjections: {
      snapshot: () => ({ values: recorded === undefined ? {} : { modelSelection: recorded } }),
    },
  }
}

const cases = []
async function check(name, fn, expected) {
  const calls = []
  let error
  try {
    await fn(calls)
  } catch (e) {
    error = e
  }
  const got = calls.length === 0 ? 'none' : JSON.stringify(calls)
  const pass = got === expected && !error
  cases.push({ name, pass, got, expected, error: error?.message })
}

const entry = { workspaceId: 'w1', provider: 'cpa', model: 'claude-sonnet-5', reasoningEffort: 'high' }
const bare = { workspaceId: 'w1', provider: 'cpa', model: 'claude-sonnet-5' }
const applied = JSON.stringify([{ provider: 'cpa', model: 'claude-sonnet-5', reasoningEffort: 'high' }])

// --- async path (agent/created) ---
await check('async: subagent skipped',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' } }), makeConfig([entry]), makeAgent({ origin: 'subagent', onSelect: s => calls.push(s) })),
  'none')

await check('async: missing cwd skipped',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' } }), makeConfig([entry]), makeAgent({ cwd: '', onSelect: s => calls.push(s) })),
  'none')

await check('async: resume with a request header skipped',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' } }), makeConfig([entry]), makeAgent({ header: { config: { provider: 'x', model: 'y' } }, onSelect: s => calls.push(s) })),
  'none')

await check('async: blank resume applies',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' } }), makeConfig([entry]), makeAgent({ header: undefined, onSelect: s => calls.push(s) })),
  applied)

await check('async: resolve error skipped',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' }, throwOnResolve: true }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  'none')

await check('async: unknown workspace skipped',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: undefined }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  'none')

await check('async: workspace without entry skipped',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'other' } }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  'none')

await check('async: entry applies with effort',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' } }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  applied)

await check('async: entry applies without effort',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' } }), makeConfig([bare]), makeAgent({ onSelect: s => calls.push(s) })),
  JSON.stringify([{ provider: 'cpa', model: 'claude-sonnet-5' }]))

await check('async: recorded lastUsed wins',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' }, recorded: { lastUsed: { provider: 'x', model: 'y' }, next: null } }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  'none')

await check('async: pending next wins',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' }, recorded: { lastUsed: null, next: { provider: 'x', model: 'y' } } }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  'none')

await check('async: empty projection applies',
  (calls) => applyWorkspaceDefault(makeCtx({ workspace: { id: 'w1' }, recorded: { lastUsed: null, next: null } }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  applied)

// --- sync path (agent/inbox/claimed) ---
await check('sync: blank live agent applies',
  (calls) => applyWorkspaceDefaultSync(makeCtx({ workspaces: [{ id: 'w1', path: '/work/a' }] }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  applied)

await check('sync: unknown path skipped',
  (calls) => applyWorkspaceDefaultSync(makeCtx({ workspaces: [{ id: 'w1', path: '/work/b' }] }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  'none')

await check('sync: session with a request header skipped',
  (calls) => applyWorkspaceDefaultSync(makeCtx({ workspaces: [{ id: 'w1', path: '/work/a' }] }), makeConfig([entry]), makeAgent({ header: { config: {} }, onSelect: s => calls.push(s) })),
  'none')

await check('sync: recorded selection skipped',
  (calls) => applyWorkspaceDefaultSync(makeCtx({ workspaces: [{ id: 'w1', path: '/work/a' }], recorded: { lastUsed: { provider: 'x', model: 'y' }, next: null } }), makeConfig([entry]), makeAgent({ onSelect: s => calls.push(s) })),
  'none')

await check('sync: subagent skipped',
  (calls) => applyWorkspaceDefaultSync(makeCtx({ workspaces: [{ id: 'w1', path: '/work/a' }] }), makeConfig([entry]), makeAgent({ origin: 'subagent', onSelect: s => calls.push(s) })),
  'none')

const failed = cases.filter(c => !c.pass)
for (const c of cases) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass ? '' : `  got=${c.got} expected=${c.expected}${c.error ? ` error=${c.error}` : ''}`}`)
console.log(failed.length === 0 ? `ALL PASS (${cases.length})` : `${failed.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
