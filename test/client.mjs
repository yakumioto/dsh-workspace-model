import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const file = fileURLToPath(new URL('../client/client.js', import.meta.url))
let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      loaded = def
    },
  },
}

// DOM stubs for CSS injection.
const head = []
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild: (node) => head.push(node) },
}

const req = createRequire(import.meta.url)
new Function(readFileSync(file, 'utf8'))()

if (!loaded) throw new Error('bundle did not call __ModuleLoader__.load')
if (loaded.id !== '@yakumioto/dsh-workspace-model') throw new Error(`unexpected id ${loaded.id}`)

const mod = loaded.factory((id) => {
  if (id === 'react') return req('react')
  if (id === 'react/jsx-runtime') return req('react/jsx-runtime')
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button: () => null, Modal: () => null, IconDataOutlineRegular: () => null }
  throw new Error(`unexpected require ${id}`)
})

if (mod.name !== 'workspace-model') throw new Error(`bad name ${mod.name}`)
if (typeof mod.apply !== 'function') throw new Error('missing apply')

// Fake client context: record effect/inject/register calls.
const effects = []
const injections = []
const registrations = []
const menus = []
const toasts = []
const dicts = []
const ctx = {
  effect(fn, label) { effects.push(label); const d = fn(); return d ?? (() => {}) },
  locale: {
    register(ns, dict) { dicts.push({ ns, langs: Object.keys(dict) }) },
    bind(ns) { return (key, params) => `${ns}:${key}` },
  },
  slots: {
    inject(name, cb) {
      injections.push(name)
      const out = cb()
      if (out !== null && typeof out === 'object' && typeof out.next === 'function') {
        let step = out.next()
        while (step.done !== true) step = out.next()
        return () => {}
      }
      return out
    },
    register(def, comp) { registrations.push(def); return () => {} },
  },
  contextMenus: {
    register(def) { menus.push(def); return () => {} },
    notify(text, success) { toasts.push({ text, success }) },
  },
  remote: {
    settings: { describe: async () => ({ ok: true, value: { namespaces: [] } }) },
    session: { modelCatalog: async () => ({ ok: true, value: { default: { provider: 'p', model: 'm' }, groups: [] } }) },
  },
}

mod.apply(ctx)
if (effects.length !== 3) throw new Error(`expected 3 effects, got ${effects.length}`)
if (dicts[0]?.langs.join(',') !== 'zh,en') throw new Error('locale dicts wrong')
if (!injections.includes('shell.overlay')) throw new Error('slot not injected')
if (registrations.length !== 2) throw new Error(`expected 2 slot registrations, got ${registrations.length}`)
if (!registrations.some(def => def.name === 'shell.overlay' && def.id === 'workspace-model.dialog')) throw new Error('overlay slot missing')
if (!registrations.some(def => def.name === 'contextMenu.icon' && def.key === 'workspace-model.open')) throw new Error('icon slot missing')
if (menus.length !== 1 || menus[0].target !== 'workspace') throw new Error('menu not registered')
if (typeof menus[0].resolve !== 'function') throw new Error('menu resolve missing')
const actions = menus[0].resolve({ workspaceId: 'w1', path: '/p', displayTitle: 'P' }, undefined)
if (actions.length !== 1 || typeof actions[0].run !== 'function') throw new Error('menu action wrong')
if (actions[0].icon?.key !== 'workspace-model.open') throw new Error('menu icon missing')
if (actions[0].label !== 'workspace-model:menu.open') throw new Error(`menu label ${actions[0].label}`)

// Render the dialog component shallowly with stubbed primitives by hooking React.createElement.
console.log('SMOKE PASS', { effects, injections, menuId: menus[0].id })
